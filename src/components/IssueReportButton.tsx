import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Form, Input, Modal, Space, Typography, message } from 'antd';
import { CameraOutlined, FlagOutlined, PauseOutlined, PlayCircleOutlined, StopOutlined, VideoCameraOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface IssueReportButtonProps {
    moduleName?: string;
    route?: string;
    employeeName?: string;
    errorMessage?: string;
    initialDescription?: string;
    buttonText?: string;
    className?: string;
    menuTrigger?: boolean;
    directActions?: boolean;
    floatingToggle?: boolean;
    headerToggle?: boolean;
}

interface IssueFormValues {
    description: string;
}

function formatVideoTime(seconds: number) {
    const safeSeconds = Math.max(0, Math.min(8, Math.floor(seconds)));
    return `00:${String(safeSeconds).padStart(2, '0')}`;
}

export default function IssueReportButton({
    moduleName = 'Không xác định',
    route,
    employeeName,
    errorMessage,
    initialDescription = '',
    buttonText = 'Báo lỗi',
    className,
    menuTrigger = false,
    directActions = false,
    floatingToggle = false,
    headerToggle = false,
}: IssueReportButtonProps) {
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [capturing, setCapturing] = useState(false);
    const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
    const [videoBase64, setVideoBase64] = useState<string | null>(null);
    const [videoRecording, setVideoRecording] = useState(false);
    const [videoPaused, setVideoPaused] = useState(false);
    const [videoPreparing, setVideoPreparing] = useState(false);
    const [videoCountdown, setVideoCountdown] = useState<number | null>(null);
    const [videoElapsedSeconds, setVideoElapsedSeconds] = useState(0);
    const [menuOpen, setMenuOpen] = useState(false);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const recordingStreamRef = useRef<MediaStream | null>(null);
    const recordingChunksRef = useRef<Blob[]>([]);
    const recordingTimerRef = useRef<number | null>(null);
    const countdownTimerRef = useRef<number | null>(null);
    const elapsedTimerRef = useRef<number | null>(null);
    const videoStartTokenRef = useRef(0);
    const videoBusyRef = useRef(false);
    const videoPausedRef = useRef(false);
    const recordingStartedAtRef = useRef(0);
    const recordingElapsedMsRef = useRef(0);
    const preserveVideoOnOpenRef = useRef(false);
    const [form] = Form.useForm<IssueFormValues>();

    useEffect(() => {
        const sync = () => {
            const pendingSync = window.electronAPI?.support?.syncQueue?.();
            if (pendingSync) void pendingSync.catch(() => undefined);
        };
        sync();
        const timer = window.setInterval(sync, 60_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!open) return;
        form.setFieldsValue({
            description: initialDescription,
        });
        setScreenshotDataUrl(null);
        if (!preserveVideoOnOpenRef.current) setVideoBase64(null);
        preserveVideoOnOpenRef.current = false;
    }, [open, form, errorMessage, initialDescription]);

    const submit = async (values: IssueFormValues) => {
        setSubmitting(true);
        try {
            const api = window.electronAPI?.support;
            if (!api?.reportIssue) {
                message.error('Chức năng báo lỗi chỉ khả dụng trong ứng dụng desktop.');
                return;
            }
            const result = await api.reportIssue({
                ...values,
                module: moduleName,
                route,
                employeeName,
                errorMessage,
                screenshotBase64: screenshotDataUrl || undefined,
                videoBase64: videoBase64 || undefined,
            });
            if (!result.success) {
                message.error(result.error || 'Không thể gửi báo lỗi.');
                return;
            }
            // Máy chưa cấu hình bot báo lỗi thì không bao giờ gửi được: báo đỏ, hiện lâu.
            if (result.warning && (result.data as any)?.notConfigured) message.error(result.warning, 10);
            else if (result.warning) message.warning(result.warning, 6);
            else message.success(`Đã gửi báo lỗi ${result.data?.reportId || ''}`.trim());
            setOpen(false);
            form.resetFields();
        } catch (error) {
            message.error(error instanceof Error ? error.message : 'Không thể gửi báo lỗi.');
        } finally {
            setSubmitting(false);
        }
    };

    const captureScreenshot = async () => {
        setCapturing(true);
        try {
            const result = await window.electronAPI?.support?.captureScreenshot?.();
            if (!result?.success || !result.data?.dataUrl) {
                message.error(result?.error || 'Không thể chụp màn hình.');
                return;
            }
            setScreenshotDataUrl(result.data.dataUrl);
            message.success('Đã chụp màn hình hiện tại.');
        } catch (error) {
            message.error(error instanceof Error ? error.message : 'Không thể chụp màn hình.');
        } finally {
            setCapturing(false);
        }
    };

    const clearVideoTimers = () => {
        if (recordingTimerRef.current !== null) window.clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
        if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        if (elapsedTimerRef.current !== null) window.clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
    };

    const cancelVideoStart = () => {
        videoStartTokenRef.current += 1;
        videoBusyRef.current = false;
        clearVideoTimers();
        setVideoPreparing(false);
        setVideoCountdown(null);
    };

    const stopVideoRecording = () => {
        if (!recorderRef.current && videoBusyRef.current) {
            cancelVideoStart();
            return;
        }
        clearVideoTimers();
        const recorder = recorderRef.current;
        // MediaRecorder.stop() throws InvalidStateError when the 8-second
        // timer and the user's click arrive in the same event loop turn, or
        // when Chromium has already stopped because the capture track ended.
        // Treat that state as an already-finished recording.
        if (!recorder || recorder.state === 'inactive') return;
        try {
            recorder.stop();
        } catch (error) {
            if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') {
                message.error(error instanceof Error ? error.message : 'Không thể dừng quay màn hình.');
            }
        }
    };

    const toggleVideoPause = () => {
        const recorder = recorderRef.current;
        if (!recorder || recorder.state === 'inactive') return;
        try {
            if (recorder.state === 'recording') {
                recorder.pause();
                recordingElapsedMsRef.current = Math.min(8_000, performance.now() - recordingStartedAtRef.current);
                if (recordingTimerRef.current !== null) window.clearTimeout(recordingTimerRef.current);
                recordingTimerRef.current = null;
                videoPausedRef.current = true;
                setVideoElapsedSeconds(Math.floor(recordingElapsedMsRef.current / 1000));
                setVideoPaused(true);
                return;
            }
            if (recorder.state === 'paused') {
                recorder.resume();
                videoPausedRef.current = false;
                setVideoPaused(false);
                recordingStartedAtRef.current = performance.now() - recordingElapsedMsRef.current;
                const remainingMs = Math.max(0, 8_000 - recordingElapsedMsRef.current);
                recordingTimerRef.current = window.setTimeout(stopVideoRecording, remainingMs);
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : 'Không thể thay đổi trạng thái quay.');
        }
    };

    const startVideoRecording = async () => {
        if (videoBusyRef.current) return;
        videoBusyRef.current = true;
        const startToken = ++videoStartTokenRef.current;
        let countdownValue = 3;
        setVideoPreparing(true);
        setVideoCountdown(countdownValue);
        countdownTimerRef.current = window.setInterval(() => {
            countdownValue -= 1;
            if (startToken !== videoStartTokenRef.current) return;
            if (countdownValue <= 0) {
                if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
                setVideoCountdown(null);
                void beginVideoCapture(startToken);
                return;
            }
            setVideoCountdown(countdownValue);
        }, 1000);
    };

    const beginVideoCapture = async (startToken: number) => {
        try {
            const sourceResult = await window.electronAPI?.support?.getDesktopSource?.();
            if (startToken !== videoStartTokenRef.current) return;
            if (!sourceResult?.success || !sourceResult.data?.sourceId) {
                message.error(sourceResult?.error || 'Không tìm thấy cửa sổ ứng dụng để quay.');
                videoBusyRef.current = false;
                setVideoPreparing(false);
                return;
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    mandatory: {
                        // BrowserWindow#getMediaSourceId supplies a native window source.
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: sourceResult.data.sourceId,
                        maxWidth: 1280,
                        maxHeight: 720,
                        maxFrameRate: 12,
                    },
                },
            } as MediaStreamConstraints);
            if (startToken !== videoStartTokenRef.current) {
                stream.getTracks().forEach(track => track.stop());
                return;
            }
            const videoTracks = stream.getVideoTracks();
            if (!stream.active || videoTracks.length === 0 || videoTracks.some(track => track.readyState !== 'live')) {
                stream.getTracks().forEach(track => track.stop());
                throw new Error('Không lấy được luồng màn hình để quay. Vui lòng thử lại.');
            }
            recordingStreamRef.current = stream;
            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
                ? 'video/webm;codecs=vp8'
                : 'video/webm';
            const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 420_000 });
            recordingChunksRef.current = [];
            recorderRef.current = recorder;
            recorder.ondataavailable = event => { if (event.data.size > 0) recordingChunksRef.current.push(event.data); };
            recorder.onerror = event => {
                const errorName = event.error?.name || '';
                if (errorName !== 'InvalidStateError') {
                    message.error(event.error?.message || 'Không thể quay màn hình.');
                }
            };
            recorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop());
                if (startToken !== videoStartTokenRef.current) return;
                recordingStreamRef.current = null;
                recorderRef.current = null;
                setVideoRecording(false);
                videoPausedRef.current = false;
                setVideoPaused(false);
                setVideoPreparing(false);
                setVideoElapsedSeconds(0);
                clearVideoTimers();
                const blob = new Blob(recordingChunksRef.current, { type: mimeType });
                if (!blob.size) {
                    videoBusyRef.current = false;
                    return;
                }
                try {
                    const dataUrl = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(String(reader.result || ''));
                        reader.onerror = () => reject(reader.error || new Error('Không đọc được video'));
                        reader.readAsDataURL(blob);
                    });
                    if (startToken !== videoStartTokenRef.current) return;
                    setVideoBase64(dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : null);
                    preserveVideoOnOpenRef.current = true;
                    setOpen(true);
                    message.success('Đã quay video. Nhập mô tả rồi gửi báo cáo.');
                } catch (error) {
                    message.error(error instanceof Error ? error.message : 'Không đọc được video');
                } finally {
                    if (startToken === videoStartTokenRef.current) videoBusyRef.current = false;
                }
            };
            recorder.start(250);
            setVideoPreparing(false);
            setVideoRecording(true);
            videoPausedRef.current = false;
            setVideoPaused(false);
            setVideoElapsedSeconds(0);
            message.info('Đang quay màn hình, tối đa 8 giây.');
            recordingElapsedMsRef.current = 0;
            recordingStartedAtRef.current = performance.now();
            elapsedTimerRef.current = window.setInterval(() => {
                if (videoPausedRef.current) return;
                recordingElapsedMsRef.current = Math.min(8_000, performance.now() - recordingStartedAtRef.current);
                setVideoElapsedSeconds(Math.floor(recordingElapsedMsRef.current / 1000));
            }, 200);
            recordingTimerRef.current = window.setTimeout(stopVideoRecording, 8_000);
        } catch (error) {
            if (startToken !== videoStartTokenRef.current) return;
            videoBusyRef.current = false;
            clearVideoTimers();
            recordingStreamRef.current?.getTracks().forEach(track => track.stop());
            recordingStreamRef.current = null;
            recorderRef.current = null;
            setVideoPreparing(false);
            setVideoCountdown(null);
            setVideoRecording(false);
            videoPausedRef.current = false;
            setVideoPaused(false);
            const errorName = error instanceof DOMException ? error.name : '';
            message.error(errorName === 'InvalidStateError'
                ? 'Trình quay màn hình chưa sẵn sàng. Vui lòng bấm lại nút quay.'
                : error instanceof Error ? error.message : 'Không thể quay màn hình.');
        }
    };

    const openScreenshotReport = () => {
        if (videoPreparing) cancelVideoStart();
        preserveVideoOnOpenRef.current = false;
        setOpen(true);
        setTimeout(() => { void captureScreenshot(); }, 0);
    };

    useEffect(() => () => {
        videoStartTokenRef.current += 1;
        clearVideoTimers();
        recordingStreamRef.current?.getTracks().forEach(track => track.stop());
    }, []);

    const videoActive = videoRecording || videoPreparing || videoCountdown !== null;

    return (
        <>
            {videoCountdown !== null && createPortal(
                <div className="support-report-video-countdown" role="status" aria-live="assertive">
                    <span>{videoCountdown}</span>
                </div>, document.body
            )}
            {videoRecording && createPortal(
                <div className="support-report-video-status" role="status" aria-live="polite">
                    <span className="support-report-video-status-dot" />
                    <span>{videoPaused ? 'Đã tạm dừng' : 'Đang quay'}</span>
                    <strong>{formatVideoTime(videoElapsedSeconds)} / 00:08</strong>
                    <Button
                        type="text"
                        size="small"
                        danger
                        icon={videoPaused ? <PlayCircleOutlined /> : <PauseOutlined />}
                        aria-label={videoPaused ? 'Tiếp tục quay video' : 'Tạm dừng quay video'}
                        title={videoPaused ? 'Tiếp tục quay' : 'Tạm dừng'}
                        onClick={toggleVideoPause}
                    />
                    <Button
                        type="text"
                        size="small"
                        danger
                        icon={<StopOutlined />}
                        aria-label="Dừng quay video"
                        title="Dừng quay"
                        onClick={stopVideoRecording}
                    />
                </div>, document.body
            )}
            {headerToggle ? (
                <div className="support-report-header-launcher">
                    <Button
                        type="text"
                        shape="circle"
                        icon={<FlagOutlined />}
                        aria-label="Báo lỗi"
                        title={videoActive ? 'Dừng quay video lỗi' : 'Báo lỗi'}
                        onClick={() => {
                            if (videoActive) {
                                stopVideoRecording();
                                setMenuOpen(false);
                            } else {
                                setMenuOpen(value => !value);
                            }
                        }}
                        className={`support-report-header-trigger${menuOpen || videoActive ? ' support-report-trigger--active' : ''}`}
                    />
                    {menuOpen && (
                        <div className="support-report-header-actions" aria-label="Báo lỗi nhanh">
                            <Button type="text" shape="circle" icon={<CameraOutlined />} aria-label="Chụp màn hình lỗi" title="Chụp màn hình lỗi" onClick={openScreenshotReport} className="support-report-header-action" />
                            <Button type="text" shape="circle" icon={<VideoCameraOutlined />} aria-label="Quay video lỗi" title="Quay video lỗi" onClick={() => { void startVideoRecording(); }} className="support-report-header-action" />
                        </div>
                    )}
                </div>
            ) : floatingToggle ? (
                <div className="support-report-floating-launcher">
                    <Button
                        type="text"
                        shape="circle"
                        icon={<FlagOutlined />}
                        aria-label="Báo lỗi"
                        title={videoActive ? 'Dừng quay video lỗi' : 'Báo lỗi'}
                        onClick={() => {
                            if (videoActive) {
                                stopVideoRecording();
                                setMenuOpen(false);
                            } else {
                                setMenuOpen(value => !value);
                            }
                        }}
                        className={`support-report-floating-trigger${menuOpen || open || videoActive ? ' support-report-trigger--active' : ''}`}
                    />
                    {menuOpen && (
                        <div className="support-report-floating-actions" aria-label="Báo lỗi nhanh">
                            <Button
                                type="text"
                                shape="circle"
                                icon={<CameraOutlined />}
                                aria-label="Chụp màn hình lỗi"
                                title="Chụp màn hình lỗi"
                                onClick={openScreenshotReport}
                                className="support-report-floating-action"
                            />
                            <Button
                                type="text"
                                shape="circle"
                                icon={<VideoCameraOutlined />}
                                aria-label="Quay video lỗi"
                                title="Quay video lỗi"
                                onClick={() => { void startVideoRecording(); }}
                                className="support-report-floating-action"
                            />
                        </div>
                    )}
                </div>
            ) : directActions ? (
                <div className="support-report-floating-actions" aria-label="Báo lỗi nhanh">
                    <Button
                        type="text"
                        shape="circle"
                        icon={<CameraOutlined />}
                        aria-label="Chụp màn hình lỗi"
                        title="Chụp màn hình lỗi"
                        onClick={openScreenshotReport}
                        className={`support-report-floating-action${open ? ' support-report-trigger--active' : ''}`}
                    />
                    <Button
                        type="text"
                        shape="circle"
                        icon={<VideoCameraOutlined />}
                        aria-label={videoRecording ? 'Dừng quay video lỗi' : 'Quay video lỗi'}
                        title={videoRecording ? 'Dừng quay video lỗi' : 'Quay video lỗi'}
                        onClick={() => videoRecording ? stopVideoRecording() : void startVideoRecording()}
                        className={`support-report-floating-action${videoRecording ? ' support-report-trigger--recording' : ''}`}
                    />
                </div>
            ) : menuTrigger ? (
                <div className="support-report-menu-wrap">
                    <Button
                        type="text"
                        shape="circle"
                        icon={<FlagOutlined />}
                        aria-label="Báo lỗi"
                        title={videoActive ? 'Dừng quay video lỗi' : 'Báo lỗi'}
                        onClick={() => videoActive ? stopVideoRecording() : setMenuOpen(value => !value)}
                        className={`${className || ''}${videoActive ? ' support-report-trigger--recording' : ''}${menuOpen || open ? ' support-report-trigger--active' : ''}`}
                    />
                    {menuOpen && (
                        <div className="support-report-menu" role="menu">
                            <button type="button" onClick={() => { setMenuOpen(false); setOpen(true); setTimeout(() => { void captureScreenshot(); }, 0); }}>
                                <CameraOutlined /> Chụp màn hình lỗi
                            </button>
                            <button type="button" onClick={() => { void startVideoRecording(); }}>
                                <VideoCameraOutlined /> Quay video lỗi (tối đa 8 giây)
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <Button
                    type={errorMessage ? 'primary' : 'default'}
                    danger={Boolean(errorMessage)}
                    icon={<FlagOutlined />}
                    onClick={() => setOpen(true)}
                    className={className}
                >
                    {buttonText}
                </Button>
            )}
            <Modal
                title={<Space><FlagOutlined style={{ color: '#cf1322' }} /> Báo cáo sự cố</Space>}
                open={open}
                onCancel={() => !submitting && setOpen(false)}
                destroyOnClose
                okText="Gửi báo cáo"
                cancelText="Hủy"
                confirmLoading={submitting}
                onOk={() => form.submit()}
            >
                <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
                    <Text type="secondary">Màn hình: {moduleName}{route ? ` · ${route}` : ''}</Text>
                    {errorMessage && <Text type="danger">Lỗi tự động phát hiện: {errorMessage}</Text>}
                    <Button icon={<CameraOutlined />} loading={capturing} onClick={captureScreenshot}>
                        {screenshotDataUrl ? 'Chụp lại màn hình' : 'Chụp màn hình hiện tại'}
                    </Button>
                    {screenshotDataUrl && (
                        <img
                            src={screenshotDataUrl}
                            alt="Ảnh màn hình báo lỗi"
                            style={{ width: '100%', maxHeight: 220, objectFit: 'contain', border: '1px solid #d9d9d9', borderRadius: 8, background: '#f5f5f5' }}
                        />
                    )}
                    {videoBase64 && <Text type="success"><VideoCameraOutlined /> Video đã sẵn sàng (tối đa 8 giây).</Text>}
                </Space>
                <Form<IssueFormValues> form={form} layout="vertical" onFinish={submit}>
                    <Form.Item name="description" label="Mô tả lỗi" rules={[{ required: true, whitespace: true, message: 'Nhập mô tả lỗi' }]}>
                        <Input.TextArea rows={5} maxLength={1200} showCount placeholder="Bạn đang thao tác gì? Kết quả thực tế ra sao?" />
                    </Form.Item>
                </Form>
            </Modal>
        </>
    );
}

export function CrashIssueReportButton(props: Omit<IssueReportButtonProps, 'buttonText'>) {
    return <IssueReportButton {...props} buttonText="Gửi báo lỗi này" />;
}

export function FloatingIssueReportButtons(props: Omit<IssueReportButtonProps, 'buttonText' | 'className' | 'menuTrigger' | 'directActions' | 'floatingToggle'>) {
    return <IssueReportButton {...props} floatingToggle buttonText="Báo lỗi" />;
}

export function HeaderIssueReportButton(props: Omit<IssueReportButtonProps, 'buttonText' | 'className' | 'menuTrigger' | 'directActions' | 'floatingToggle' | 'headerToggle'>) {
    return <IssueReportButton {...props} headerToggle buttonText="Báo lỗi" />;
}


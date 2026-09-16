import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Space, Tag, Typography, message } from 'antd';
import { CameraOutlined, CopyOutlined, ExperimentOutlined, MobileOutlined, PictureOutlined, PoweroffOutlined, QrcodeOutlined, RocketOutlined } from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import './TestingLab.css';

const { Title, Paragraph, Text } = Typography;

interface EvidenceTestTask {
  id: string;
  title: string;
  assignee: string;
  category: string;
  dueTime: string;
  requiredCount: number;
}

interface EvidenceTestImage {
  id: string;
  taskId: string;
  taskTitle: string;
  requiredCount: number;
  name: string;
  size: number;
  dataUrl: string;
  at: string;
}

const EVIDENCE_TEST_TASKS: EvidenceTestTask[] = [
  { id: 'test-packing-area', title: 'Chụp ảnh khu vực đóng hàng cuối ca', assignee: 'Yến', category: 'Đóng hàng', dueTime: '17:30', requiredCount: 2 },
  { id: 'test-stock-shelf', title: 'Sắp xếp và chụp kệ khẩu trang kho A', assignee: 'Yến', category: 'Kho hàng', dueTime: '18:00', requiredCount: 3 },
  { id: 'test-cashier-desk', title: 'Vệ sinh quầy thu ngân và chụp xác nhận', assignee: 'Yến', category: 'Vệ sinh', dueTime: '19:00', requiredCount: 1 },
];

export default function TestingLab() {
  const [scanSession, setScanSession] = useState<{ url: string; address: string; secure: boolean } | null>(null);
  const [scanHistory, setScanHistory] = useState<Array<{ code: string; employee?: string; status?: string; message?: string; at: string }>>([]);
  const [connectedDevices, setConnectedDevices] = useState<Record<string, string>>({});
  const [startingScanner, setStartingScanner] = useState(false);
  const [evidenceSession, setEvidenceSession] = useState<({ url: string; address: string; secure: boolean; expiresAt: number; employee: string; tasks: EvidenceTestTask[] }) | null>(null);
  const [evidenceImagesByTask, setEvidenceImagesByTask] = useState<Record<string, EvidenceTestImage[]>>({});
  const [startingEvidence, setStartingEvidence] = useState(false);

  useEffect(() => window.electronAPI.mobileScanTest.onReceived((scan) => {
    setScanHistory((current) => [scan, ...current].slice(0, 20));
    void (scan.status === 'fail' ? message.error(`Lỗi từ ${scan.employee || 'điện thoại'}: ${scan.message || scan.code}`) : message.success(`${scan.employee || 'Điện thoại'} vừa gửi mã: ${scan.code}`));
  }), []);

  useEffect(() => window.electronAPI.mobileScanTest.onDevice((device) => {
    setConnectedDevices((current) => {
      const next = { ...current };
      if (device.connected) next[device.deviceId] = device.employee || 'Nhân viên';
      else delete next[device.deviceId];
      return next;
    });
  }), []);

  useEffect(() => window.electronAPI.mobileEvidenceTest.onReceived((image) => {
    setEvidenceImagesByTask((current) => ({
      ...current,
      [image.taskId]: [image, ...(current[image.taskId] || [])].slice(0, 5),
    }));
    void message.success(`${image.taskTitle}: vừa nhận ảnh ${image.name}`);
  }), []);

  useEffect(() => () => {
    void window.electronAPI.mobileScanTest.stop();
    void window.electronAPI.mobileEvidenceTest.stop();
  }, []);

  const startMobileScanner = async () => {
    setStartingScanner(true);
    try {
      const result = await window.electronAPI.mobileScanTest.start();
      setScanSession({ url: result.url, address: result.address, secure: result.secure });
      setScanHistory([]);
      setConnectedDevices({});
    } catch (error) {
      void message.error(error instanceof Error ? error.message : 'Không thể mở máy chủ quét thử.');
    } finally {
      setStartingScanner(false);
    }
  };

  const stopMobileScanner = async () => {
    await window.electronAPI.mobileScanTest.stop();
    setScanSession(null);
    setConnectedDevices({});
  };

  const startMobileEvidence = async () => {
    setStartingEvidence(true);
    try {
      const employee = EVIDENCE_TEST_TASKS[0].assignee;
      const result = await window.electronAPI.mobileEvidenceTest.start({
        employee,
        tasks: EVIDENCE_TEST_TASKS.map(({ id, title, category, dueTime, requiredCount }) => ({ id, title, category, dueTime, requiredCount })),
      });
      setEvidenceSession({
        url: result.url,
        address: result.address,
        secure: result.secure,
        expiresAt: result.expiresAt,
        employee: result.employee,
        tasks: EVIDENCE_TEST_TASKS,
      });
      setEvidenceImagesByTask({});
    } catch (error) {
      void message.error(error instanceof Error ? error.message : 'Không thể tạo phiên nộp ảnh thử.');
    } finally {
      setStartingEvidence(false);
    }
  };

  const stopMobileEvidence = async () => {
    await window.electronAPI.mobileEvidenceTest.stop();
    setEvidenceSession(null);
  };

  const testUpdateInterface = () => {
    window.dispatchEvent(new CustomEvent('dby:update-ui-test', {
      detail: {
        status: 'installing',
        percent: 84,
        currentVersion: '1.0.397',
        latestVersion: '1.0.398',
      },
    }));
  };

  const completedEvidenceTasks = EVIDENCE_TEST_TASKS.filter((task) => (evidenceImagesByTask[task.id] || []).length >= task.requiredCount).length;

  return (
    <div className="testing-lab">
      <Space align="center" className="testing-lab__heading">
        <ExperimentOutlined />
        <Title level={2}>Kiểm thử</Title>
      </Space>
      <Paragraph type="secondary">
        Khu vực dành riêng cho quản trị viên kiểm tra giao diện mô phỏng mà không thay đổi dữ liệu thật.
      </Paragraph>

      <Card className="testing-lab__card">
        <div className="testing-lab__content">
          <div className="testing-lab__icon"><RocketOutlined /></div>
          <div className="testing-lab__copy">
            <Title level={4}>Kiểm thử giao diện cập nhật</Title>
            <Paragraph>
              Chạy mô phỏng mẫu 3 để kiểm tra bố cục toàn màn hình. Chế độ này <Text strong>không tải, không cài đặt</Text> và không thay đổi phiên bản ứng dụng.
            </Paragraph>
          </div>
          <Button type="primary" size="large" icon={<RocketOutlined />} onClick={testUpdateInterface}>
            Kiểm thử giao diện cập nhật
          </Button>
        </div>
      </Card>

      <Card className="testing-lab__card testing-lab__scanner-card testing-lab__evidence-card">
        <div className="testing-lab__scanner-header">
          <div>
            <Space align="center">
              <CameraOutlined className="testing-lab__scanner-title-icon" />
              <Title level={4}>Điện thoại nộp bằng chứng công việc</Title>
              <Tag color="gold">Luồng thử độc lập</Tag>
            </Space>
            <Paragraph>
              Tạo một QR cho cả ca của Yến. Điện thoại sẽ hiển thị toàn bộ công việc, gửi xong một việc thì tiếp tục việc kế tiếp mà không cần quét lại.
            </Paragraph>
          </div>
          {evidenceSession ? (
            <Button danger icon={<PoweroffOutlined />} onClick={stopMobileEvidence}>Dừng phiên điện thoại</Button>
          ) : (
            <Button type="primary" icon={<QrcodeOutlined />} loading={startingEvidence} onClick={startMobileEvidence}>
              Tạo QR cho cả ca
            </Button>
          )}
        </div>

        <div className="testing-lab__session-summary">
          <div>
            <Text strong>Nhân viên: Yến</Text>
            <Text type="secondary">3 công việc hôm nay · chỉ cần quét QR một lần</Text>
          </div>
          <Tag color={completedEvidenceTasks === EVIDENCE_TEST_TASKS.length ? 'green' : 'blue'}>
            {completedEvidenceTasks}/{EVIDENCE_TEST_TASKS.length} công việc hoàn tất
          </Tag>
        </div>

        <div className="testing-lab__task-list">
          {EVIDENCE_TEST_TASKS.map((task) => {
            const images = evidenceImagesByTask[task.id] || [];
            const completed = images.length >= task.requiredCount;
            return (
              <div className={`testing-lab__task-row${completed ? ' is-completed' : ''}`} key={task.id}>
                <div className="testing-lab__task-status"><span>{completed ? '✓' : images.length}</span></div>
                <div className="testing-lab__task-main">
                  <Text strong>{task.title}</Text>
                  <Space size={[6, 6]} wrap>
                    <Tag color="blue">{task.category}</Tag>
                    <Text type="secondary">Người làm: {task.assignee}</Text>
                    <Text type="secondary">Hạn {task.dueTime}</Text>
                    <Text type="secondary">Tối thiểu {task.requiredCount} ảnh</Text>
                  </Space>
                </div>
                <div className="testing-lab__task-progress">
                  <Tag color={completed ? 'green' : images.length ? 'gold' : 'default'}>{completed ? 'Hoàn tất thử' : `${images.length}/${task.requiredCount} ảnh`}</Tag>
                </div>
              </div>
            );
          })}
        </div>

        {evidenceSession ? (
          <div className="testing-lab__scanner-grid">
            <div className="testing-lab__qr-panel">
              <QRCodeSVG value={evidenceSession.url} size={196} level="M" marginSize={2} />
              <Text strong>Công việc hôm nay của {evidenceSession.employee}</Text>
              <Text type="secondary">{evidenceSession.tasks.length} công việc · QR dùng liên tục trong ca</Text>
              <Text type="secondary">Phiên thử hết hạn sau 8 giờ</Text>
              <div className="testing-lab__url-row">
                <Text code ellipsis={{ tooltip: evidenceSession.url }}>{evidenceSession.url}</Text>
                <Button
                  icon={<CopyOutlined />}
                  onClick={() => navigator.clipboard.writeText(evidenceSession.url).then(() => message.success('Đã sao chép đường dẫn'))}
                />
              </div>
              <Alert
                showIcon
                type={evidenceSession.secure ? 'success' : 'warning'}
                message={evidenceSession.secure ? 'Điện thoại đã sẵn sàng cho cả ca' : 'Đang dùng mạng LAN dự phòng'}
                description={evidenceSession.secure ? 'Quét QR một lần, sau đó chọn và nộp lần lượt mọi công việc trên điện thoại.' : 'Điện thoại và PC cần cùng Wi-Fi. Trình duyệt có thể hạn chế camera trên HTTP.'}
              />
            </div>
            <div className="testing-lab__scan-results">
              <div className="testing-lab__results-heading">
                <Title level={5}>Ảnh nhận trong phiên của {evidenceSession.employee}</Title>
                <Tag color={completedEvidenceTasks === EVIDENCE_TEST_TASKS.length ? 'green' : 'blue'}>{completedEvidenceTasks}/{EVIDENCE_TEST_TASKS.length} việc</Tag>
              </div>
              {Object.values(evidenceImagesByTask).some((images) => images.length > 0) ? (
                <div className="testing-lab__evidence-task-groups">
                  {EVIDENCE_TEST_TASKS.map((task) => {
                    const images = evidenceImagesByTask[task.id] || [];
                    if (!images.length) return null;
                    return (
                      <div className="testing-lab__evidence-task-group" key={task.id}>
                        <div className="testing-lab__evidence-task-heading">
                          <Text strong>{task.title}</Text>
                          <Tag color={images.length >= task.requiredCount ? 'green' : 'gold'}>{images.length}/{task.requiredCount} ảnh</Tag>
                        </div>
                        <div className="testing-lab__evidence-grid">
                          {images.map((image, index) => (
                            <figure className="testing-lab__evidence-item" key={image.id}>
                              <img src={image.dataUrl} alt={`Bằng chứng thử ${images.length - index}`} />
                              <figcaption>
                                <Text strong ellipsis={{ tooltip: image.name }}>{image.name}</Text>
                                <Text type="secondary">{(image.size / 1024 / 1024).toFixed(1)} MB · {new Date(image.at).toLocaleTimeString('vi-VN')}</Text>
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Đang chờ điện thoại chọn công việc và gửi ảnh..." />}
              {completedEvidenceTasks === EVIDENCE_TEST_TASKS.length && (
                <Alert className="testing-lab__evidence-success" showIcon type="success" message="Đã hoàn tất toàn bộ công việc trong phiên thử" description="Điện thoại đã nộp lần lượt cả 3 công việc từ một QR duy nhất." />
              )}
            </div>
          </div>
        ) : (
          <Alert showIcon type="info" icon={<PictureOutlined />} message="Chưa tạo phiên điện thoại cho Yến" description="Bấm Tạo QR cho cả ca. Sau khi quét, điện thoại sẽ thấy đồng thời cả 3 công việc phía trên." />
        )}
      </Card>

      <Card className="testing-lab__card testing-lab__scanner-card">
        <div className="testing-lab__scanner-header">
          <div>
            <Space align="center">
              <MobileOutlined className="testing-lab__scanner-title-icon" />
              <Title level={4}>Điện thoại làm máy quét</Title>
              <Tag color="gold">Chỉ kiểm thử</Tag>
            </Space>
            <Paragraph>
              Mã nhận được chỉ hiển thị tại đây, không tìm đơn, không trừ tồn kho và không tác động dữ liệu thật.
            </Paragraph>
          </div>
          {scanSession ? (
            <Button danger icon={<PoweroffOutlined />} onClick={stopMobileScanner}>Dừng phiên</Button>
          ) : (
            <Button type="primary" icon={<QrcodeOutlined />} loading={startingScanner} onClick={startMobileScanner}>
              Tạo QR kết nối
            </Button>
          )}
        </div>

        {scanSession ? (
          <div className="testing-lab__scanner-grid">
            <div className="testing-lab__qr-panel">
              <QRCodeSVG value={scanSession.url} size={196} level="M" marginSize={2} />
              <Text strong>Quét QR này bằng iPhone</Text>
              <Text type="secondary">{scanSession.secure ? 'HTTPS: camera liên tục đã sẵn sàng' : 'Dự phòng LAN: điện thoại và PC cần cùng Wi-Fi'}</Text>
              <div className="testing-lab__url-row">
                <Text code ellipsis={{ tooltip: scanSession.url }}>{scanSession.url}</Text>
                <Button
                  icon={<CopyOutlined />}
                  onClick={() => navigator.clipboard.writeText(scanSession.url).then(() => message.success('Đã sao chép đường dẫn'))}
                />
              </div>
              <Alert showIcon type={scanSession.secure ? 'success' : 'warning'} message={scanSession.secure ? 'Camera quét liên tục qua HTTPS' : 'Không tạo được HTTPS, đang dùng LAN dự phòng'} description={scanSession.secure ? 'Mở QR trên iPhone, cấp quyền camera và hướng mã vào khung. Hệ thống tự gửi ngay khi nhận diện.' : 'Safari chỉ cho phép chụp ảnh mã ở chế độ HTTP.'} />
            </div>
            <div className="testing-lab__scan-results">
              <div className="testing-lab__results-heading">
                <Title level={5}>Mã nhận từ điện thoại</Title>
                <Space><Tag color="blue">{Object.keys(connectedDevices).length} điện thoại</Tag><Tag color={scanHistory.length ? 'green' : 'default'}>{scanHistory.length} mã</Tag></Space>
              </div>
              {scanHistory.length ? scanHistory.map((scan, index) => (
                <div className="testing-lab__scan-item" key={`${scan.at}-${index}`}>
                  <QrcodeOutlined style={{ color: scan.status === 'fail' ? '#b42318' : '#075439' }} />
                  <span><Text strong copyable>{scan.code}</Text><br /><Text type="secondary">{scan.employee || 'Nhân viên'} · {scan.status === 'fail' ? (scan.message || 'Lỗi') : 'Thành công'}</Text></span>
                  <Text type="secondary">{new Date(scan.at).toLocaleTimeString('vi-VN')}</Text>
                </div>
              )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Đang chờ điện thoại gửi mã..." />}
            </div>
          </div>
        ) : (
          <Alert showIcon type="info" message="Chưa có phiên quét" description="Bấm Tạo QR kết nối để mở trang thử nghiệm trên điện thoại." />
        )}
      </Card>
    </div>
  );
}

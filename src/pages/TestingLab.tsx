import { useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Space, Tag, Typography, message } from 'antd';
import { CopyOutlined, ExperimentOutlined, MobileOutlined, PoweroffOutlined, QrcodeOutlined, RocketOutlined } from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import './TestingLab.css';

const { Title, Paragraph, Text } = Typography;

export default function TestingLab() {
  const [scanSession, setScanSession] = useState<{ url: string; address: string; secure: boolean } | null>(null);
  const [scanHistory, setScanHistory] = useState<Array<{ code: string; employee?: string; status?: string; message?: string; at: string }>>([]);
  const [connectedDevices, setConnectedDevices] = useState<Record<string, string>>({});
  const [startingScanner, setStartingScanner] = useState(false);

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

  useEffect(() => () => {
    void window.electronAPI.mobileScanTest.stop();
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

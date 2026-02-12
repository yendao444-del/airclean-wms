import { useState, useEffect } from 'react';
import {
  Button,
  Card,
  Modal,
  message,

  Space,
  Typography,
  Divider,
  Alert,
  Table,
  Popconfirm,
  Tabs,
  Row,
  Col,
  Statistic
} from 'antd';
import {
  ExportOutlined,
  ImportOutlined,
  DatabaseOutlined,
  WarningOutlined,

  ReloadOutlined,
  DeleteOutlined,
  CloudUploadOutlined,
  FolderOpenOutlined,
  FileZipOutlined,

  ClockCircleOutlined,
  CloudDownloadOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  HistoryOutlined,
  RocketOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;

interface BackupFile {
  filename: string;
  path: string;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
}

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseNotes: string;
  publishedAt: string;
  downloadUrl: string | null;
  downloadSize: number;
}

interface UpdateHistoryItem {
  version: string;
  date: string;
  status: string;
}

const Settings = () => {
  const [loading, setLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backups, setBackups] = useState<BackupFile[]>([]);

  // Update states
  const [currentVersion, setCurrentVersion] = useState('...');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [updateHistory, setUpdateHistory] = useState<UpdateHistoryItem[]>([]);

  // Load danh sách backups + version + update history khi component mount
  useEffect(() => {
    loadBackups();
    loadCurrentVersion();
    loadUpdateHistory();
    // Auto check update
    handleCheckUpdate(true);
  }, []);

  const loadCurrentVersion = async () => {
    try {
      const result = await window.electronAPI.update.getCurrentVersion();
      if (result.success && result.data) {
        setCurrentVersion(result.data);
      }
    } catch { }
  };

  const loadUpdateHistory = async () => {
    try {
      const result = await window.electronAPI.update.getHistory();
      if (result.success && result.data) {
        setUpdateHistory(result.data);
      }
    } catch { }
  };

  const handleCheckUpdate = async (silent = false) => {
    try {
      setCheckingUpdate(true);
      const result = await window.electronAPI.update.check();
      if (result.success && result.data) {
        setUpdateInfo(result.data);
        setCurrentVersion(result.data.currentVersion);
        if (!silent) {
          if (result.data.hasUpdate) {
            message.info(`Có bản cập nhật mới: v${result.data.latestVersion}`);
          } else {
            message.success('Bạn đang dùng phiên bản mới nhất!');
          }
        }
      } else if (!silent) {
        message.error(`Lỗi kiểm tra: ${result.error}`);
      }
    } catch (error: any) {
      if (!silent) message.error(`Lỗi: ${error.message}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleDownloadUpdate = async () => {
    // Kiểm tra update mới trước
    try {
      setCheckingUpdate(true);
      const result = await window.electronAPI.update.check();
      setCheckingUpdate(false);

      if (!result.success || !result.data) {
        message.error(result.error || 'Không thể kiểm tra phiên bản mới nhất!');
        return;
      }

      const latestUpdateInfo = result.data;
      setUpdateInfo(latestUpdateInfo);
      setCurrentVersion(latestUpdateInfo.currentVersion);

      // Nếu không có update, thông báo
      if (!latestUpdateInfo.hasUpdate) {
        message.info('Bạn đang dùng phiên bản mới nhất!');
        return;
      }

      // Nếu không có link download
      if (!latestUpdateInfo.downloadUrl) {
        message.error('Không tìm thấy link tải!');
        return;
      }

      // Hiển thị modal xác nhận
      Modal.confirm({
        title: 'Cập nhật phần mềm',
        icon: <CloudDownloadOutlined style={{ color: '#1890ff' }} />,
        content: (
          <div>
            <p>Cập nhật từ <strong>v{latestUpdateInfo.currentVersion}</strong> lên <strong>v{latestUpdateInfo.latestVersion}</strong></p>
            {latestUpdateInfo.releaseNotes && (
              <Alert
                message="Ghi chú thay đổi"
                description={latestUpdateInfo.releaseNotes}
                type="info"
                showIcon
                style={{ marginTop: 12 }}
              />
            )}
            <Alert
              message="Ứng dụng sẽ tự động khởi động lại sau khi cập nhật."
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
            />
          </div>
        ),
        okText: 'Cập nhật ngay',
        cancelText: 'Hủy',
        onOk: async () => {
          try {
            setDownloading(true);
            message.loading({ content: 'Đang tải bản cập nhật...', key: 'update', duration: 0 });

            const downloadResult = await window.electronAPI.update.download(latestUpdateInfo.downloadUrl!);

            if (downloadResult.success && downloadResult.data) {
              message.success({ content: `Cập nhật thành công v${downloadResult.data.version}! Đang khởi động lại...`, key: 'update', duration: 3 });
              await loadUpdateHistory();
              // Restart sau 2 giây
              setTimeout(async () => {
                await window.electronAPI.update.restart();
              }, 2000);
            } else {
              message.error({ content: `Lỗi cập nhật: ${downloadResult.error}`, key: 'update' });
            }
          } catch (error: any) {
            message.error({ content: `Lỗi: ${error.message}`, key: 'update' });
          } finally {
            setDownloading(false);
          }
        }
      });
    } catch (error: any) {
      setCheckingUpdate(false);
      message.error(`Lỗi: ${error.message}`);
    }
  };

  const loadBackups = async () => {
    try {
      const result = await window.electronAPI.system.listBackups();
      if (result.success && result.data) {
        setBackups(result.data);
      }
    } catch (error: any) {
      console.error('Error loading backups:', error);
    }
  };

  const handleBackup = async () => {
    try {
      setBackupLoading(true);
      message.loading({ content: 'Đang sao lưu hệ thống...', key: 'backup', duration: 0 });

      const result = await window.electronAPI.system.backup();

      if (result.success && result.data) {
        const sizeMB = (result.data.size / 1024 / 1024).toFixed(2);
        message.success({
          content: `✅ Sao lưu thành công! File: ${result.data.filename} (${sizeMB} MB)`,
          key: 'backup',
          duration: 5
        });
        await loadBackups();
      } else {
        message.error({ content: `Lỗi: ${result.error}`, key: 'backup' });
      }
    } catch (error: any) {
      message.error({ content: `Lỗi không mong đợi: ${error.message}`, key: 'backup' });
    } finally {
      setBackupLoading(false);
    }
  };

  const handleRestore = (backupPath: string, filename: string) => {
    Modal.confirm({
      title: 'Xác nhận khôi phục hệ thống',
      icon: <WarningOutlined style={{ color: '#ff4d4f' }} />,
      content: (
        <div>
          <Alert
            message="Cảnh báo nghiêm trọng"
            description={
              <div>
                <p><strong>Hành động này sẽ:</strong></p>
                <ul style={{ paddingLeft: 20 }}>
                  <li>Ghi đè toàn bộ dữ liệu hiện tại</li>
                  <li>Khôi phục về trạng thái: <strong>{filename}</strong></li>
                  <li>Yêu cầu khởi động lại ứng dụng</li>
                </ul>
                <p style={{ marginTop: 12, color: '#ff4d4f' }}>
                  <strong>Khuyến nghị: Tạo backup hiện tại trước khi khôi phục!</strong>
                </p>
              </div>
            }
            type="error"
            showIcon
            style={{ marginTop: 16, marginBottom: 16 }}
          />
          <Text>Bạn có chắc chắn muốn tiếp tục?</Text>
        </div>
      ),
      okText: 'Khôi phục',
      cancelText: 'Hủy',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          setBackupLoading(true);
          message.loading({ content: 'Đang khôi phục hệ thống...', key: 'restore', duration: 0 });

          const result = await window.electronAPI.system.restore(backupPath);

          if (result.success) {
            Modal.success({
              title: 'Khôi phục thành công!',
              content: (
                <div>
                  <p>{result.data?.message}</p>
                  <Alert
                    message="Vui lòng đóng và mở lại ứng dụng để áp dụng thay đổi."
                    type="info"
                    showIcon
                    style={{ marginTop: 12 }}
                  />
                </div>
              )
            });
            message.destroy('restore');
          } else {
            message.error({ content: `Lỗi: ${result.error}`, key: 'restore' });
          }
        } catch (error: any) {
          message.error({ content: `Lỗi: ${error.message}`, key: 'restore' });
        } finally {
          setBackupLoading(false);
        }
      }
    });
  };

  const handleDeleteBackup = async (backupPath: string, filename: string) => {
    try {
      const result = await window.electronAPI.system.deleteBackup(backupPath);
      if (result.success) {
        message.success(`Đã xóa backup: ${filename}`);
        await loadBackups();
      } else {
        message.error(`Lỗi: ${result.error}`);
      }
    } catch (error: any) {
      message.error(`Lỗi: ${error.message}`);
    }
  };

  const handleBrowseAndRestore = async () => {
    try {
      const browseResult = await window.electronAPI.system.browseAndRestore();

      if (!browseResult.success || !browseResult.data) {
        if (browseResult.error !== 'User cancelled') {
          message.error(browseResult.error || 'Lỗi khi chọn file');
        }
        return;
      }

      const filePath = browseResult.data.filePath;
      const fileName = filePath.split('\\').pop() || filePath.split('/').pop() || 'backup.zip';

      Modal.confirm({
        title: 'Xác nhận khôi phục từ file',
        icon: <WarningOutlined style={{ color: '#ff4d4f' }} />,
        content: (
          <div>
            <Alert
              message="Cảnh báo nghiêm trọng"
              description={
                <div>
                  <p><strong>File đã chọn:</strong> {fileName}</p>
                  <p><strong>Hành động này sẽ:</strong></p>
                  <ul style={{ paddingLeft: 20 }}>
                    <li>Tự động tạo backup an toàn của dữ liệu hiện tại</li>
                    <li>Kiểm tra tính hợp lệ của file backup</li>
                    <li>Ghi đè toàn bộ dữ liệu hiện tại</li>
                    <li>Yêu cầu khởi động lại ứng dụng</li>
                  </ul>
                  <p style={{ marginTop: 12, color: '#52c41a' }}>
                    ✅ Dữ liệu hiện tại sẽ được backup tự động trước khi khôi phục
                  </p>
                </div>
              }
              type="error"
              showIcon
              style={{ marginTop: 16, marginBottom: 16 }}
            />
            <Text>Bạn có chắc chắn muốn tiếp tục?</Text>
          </div>
        ),
        okText: 'Khôi phục',
        cancelText: 'Hủy',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            setBackupLoading(true);
            message.loading({ content: 'Đang khôi phục hệ thống...', key: 'restore', duration: 0 });

            const result = await window.electronAPI.system.restore(filePath);

            if (result.success && result.data) {
              Modal.success({
                title: 'Khôi phục thành công!',
                content: (
                  <div>
                    <p>✅ Đã khôi phục {result.data.filesRestored} files/folders</p>
                    <p>💾 Backup an toàn: {result.data.safetyBackup}</p>
                    <Alert
                      message="Vui lòng đóng và mở lại ứng dụng ngay để áp dụng thay đổi."
                      type="warning"
                      showIcon
                      style={{ marginTop: 12 }}
                    />
                  </div>
                )
              });
              message.destroy('restore');
              await loadBackups();
            } else {
              message.error({ content: `Lỗi: ${result.error}`, key: 'restore' });
            }
          } catch (error: any) {
            message.error({ content: `Lỗi: ${error.message}`, key: 'restore' });
          } finally {
            setBackupLoading(false);
          }
        }
      });
    } catch (error: any) {
      message.error(`Lỗi: ${error.message}`);
    }
  };

  const handleInspectBackup = async (backupPath: string) => {
    try {
      const result = await window.electronAPI.system.inspectBackup(backupPath);

      if (result.success && result.data) {
        const info = result.data;

        Modal.info({
          title: `🔍 Thông tin chi tiết Backup`,
          width: 800,
          content: (
            <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div style={{ marginBottom: 20 }}>
                <Text strong style={{ fontSize: 16 }}>📁 Thông tin file</Text>
                <div style={{ marginTop: 8, paddingLeft: 12 }}>
                  <p><strong>Tên file:</strong> {info.filename}</p>
                  <p><strong>Kích thước:</strong> {info.fileSizeMB} MB</p>
                  <p><strong>Ngày tạo:</strong> {dayjs(info.created).format('DD/MM/YYYY HH:mm:ss')}</p>
                  <p><strong>Tỉ lệ nén:</strong> {info.compressionRatio}%</p>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <Text strong style={{ fontSize: 16 }}>✅ Kiểm tra tính hợp lệ</Text>
                <div style={{ marginTop: 8 }}>
                  {info.isValid ? (
                    <Alert message="File backup hợp lệ và có thể khôi phục" type="success" showIcon />
                  ) : (
                    <Alert message="Cảnh báo: File backup thiếu các thành phần quan trọng!" type="error" showIcon />
                  )}
                  <div style={{ marginTop: 12, paddingLeft: 12 }}>
                    <p>✅ src/: {info.validation.hasSrc ? '✅ Có' : '❌ Không'}</p>
                    <p>✅ electron/: {info.validation.hasElectron ? '✅ Có' : '❌ Không'}</p>
                    <p>✅ prisma/: {info.validation.hasPrisma ? '✅ Có' : '❌ Không'}</p>
                    <p>✅ package.json: {info.validation.hasPackageJson ? '✅ Có' : '❌ Không'}</p>
                    <p>✅ node_modules/: {info.validation.hasNodeModules ? '✅ Có' : '❌ Không'}</p>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <Text strong style={{ fontSize: 16 }}>📊 Thống kê nội dung</Text>
                <div style={{ marginTop: 8, paddingLeft: 12 }}>
                  <p><strong>Tổng số files:</strong> {info.totalFiles.toLocaleString()}</p>
                  <p><strong>Tổng số folders:</strong> {info.totalFolders.toLocaleString()}</p>
                  <p><strong>Dung lượng giải nén:</strong> {info.uncompressedSizeMB} MB</p>
                </div>
              </div>

              {info.mainFolders && info.mainFolders.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <Text strong style={{ fontSize: 16 }}>📂 Cấu trúc thư mục chính</Text>
                  <div style={{ marginTop: 8, paddingLeft: 12 }}>
                    {info.mainFolders.map((folder: string) => (
                      <p key={folder}>📁 {folder}</p>
                    ))}
                  </div>
                </div>
              )}

              {info.largestFiles && info.largestFiles.length > 0 && (
                <div>
                  <Text strong style={{ fontSize: 16 }}>💾 Top 10 files lớn nhất</Text>
                  <div style={{ marginTop: 8, paddingLeft: 12 }}>
                    {info.largestFiles.map((file: any, idx: number) => (
                      <p key={idx} style={{ fontSize: 12 }}>
                        {idx + 1}. {file.name} ({file.sizeMB} MB)
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ),
          okText: 'Đóng'
        });
      } else {
        message.error(result.error || 'Không thể đọc thông tin backup');
      }
    } catch (error: any) {
      message.error(`Lỗi: ${error.message}`);
    }
  };

  const handleExport = async () => {
    try {
      setLoading(true);
      const result = await window.electronAPI.database.exportAll();
      setLoading(false);

      if (result.success && result.data) {
        message.success({
          content: `Xuất dữ liệu thành công! File đã được lưu tại: ${result.data}`,
          duration: 5
        });
      } else {
        if (result.error === 'User cancelled') {
          message.info('Đã hủy xuất dữ liệu');
        } else {
          message.error(`Lỗi khi xuất dữ liệu: ${result.error}`);
        }
      }
    } catch (error: any) {
      setLoading(false);
      message.error(`Lỗi không mong đợi: ${error.message}`);
    }
  };

  const handleImport = () => {
    Modal.confirm({
      title: 'Xác nhận nhập dữ liệu',
      icon: <WarningOutlined style={{ color: '#faad14' }} />,
      content: (
        <div>
          <Alert
            message="Cảnh báo quan trọng"
            description="Dữ liệu hiện tại sẽ được cập nhật hoặc ghi đè bởi dữ liệu từ file Excel. Hệ thống sẽ tự động xử lý trường hợp trùng lặp ID."
            type="warning"
            showIcon
            style={{ marginTop: 16, marginBottom: 16 }}
          />
          <Text>Bạn có chắc chắn muốn tiếp tục?</Text>
        </div>
      ),
      okText: 'Tiếp tục',
      cancelText: 'Hủy',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          setLoading(true);
          const result = await window.electronAPI.database.importAll();
          setLoading(false);

          if (result.success && result.data) {
            const stats = result.data;
            Modal.success({
              title: 'Nhập dữ liệu thành công!',
              content: (
                <div style={{ marginTop: 16 }}>
                  <Text>Đã nhập thành công:</Text>
                  <ul style={{ marginTop: 8, marginBottom: 0 }}>
                    <li>{stats.categories} danh mục sản phẩm</li>
                    <li>{stats.products} sản phẩm</li>
                    <li>{stats.suppliers} nhà cung cấp</li>
                    <li>{stats.purchases} đơn nhập hàng</li>
                    <li>{stats.customers} khách hàng</li>
                    <li>{stats.orders} đơn bán hàng</li>
                    <li>{stats.expenses} khoản chi phí</li>
                  </ul>
                </div>
              )
            });
          } else {
            if (result.error === 'No file selected') {
              message.info('Đã hủy nhập dữ liệu');
            } else {
              message.error(`Lỗi khi nhập dữ liệu: ${result.error}`);
            }
          }
        } catch (error: any) {
          setLoading(false);
          message.error(`Lỗi không mong đợi: ${error.message}`);
        }
      }
    });
  };

  const backupColumns = [
    {
      title: '📁 Tên file',
      dataIndex: 'filename',
      key: 'filename',
      ellipsis: true,
    },
    {
      title: '📊 Kích thước',
      dataIndex: 'size',
      key: 'size',
      width: 120,
      render: (size: number) => `${(size / 1024 / 1024).toFixed(2)} MB`,
    },
    {
      title: '📅 Ngày tạo',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (date: Date) => dayjs(date).format('DD/MM/YYYY HH:mm:ss'),
    },
    {
      title: '⚙️ Thao tác',
      key: 'actions',
      width: 250,
      render: (_: any, record: BackupFile) => (
        <Space size="small">
          <Button
            icon={<WarningOutlined />}
            size="small"
            onClick={() => handleInspectBackup(record.path)}
          >
            Chi tiết
          </Button>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            size="small"
            onClick={() => handleRestore(record.path, record.filename)}
          >
            Khôi phục
          </Button>
          <Popconfirm
            title="Xác nhận xóa backup"
            description={`Bạn có chắc muốn xóa "${record.filename}"?`}
            onConfirm={() => handleDeleteBackup(record.path, record.filename)}
            okText="Xóa"
            cancelText="Hủy"
            okButtonProps={{ danger: true }}
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              size="small"
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const updateHistoryColumns = [
    {
      title: 'Phiên bản',
      dataIndex: 'version',
      key: 'version',
      width: 120,
      render: (v: string) => <Text strong>v{v}</Text>,
    },
    {
      title: 'Thời gian',
      dataIndex: 'date',
      key: 'date',
      width: 200,
      render: (d: string) => dayjs(d).format('DD/MM/YYYY HH:mm:ss'),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (s: string) => (
        <span style={{ color: s === 'success' ? '#52c41a' : '#ff4d4f' }}>
          {s === 'success' ? <><CheckCircleOutlined /> Thành công</> : <><WarningOutlined /> Lỗi</>}
        </span>
      ),
    },
  ];

  // TAB ITEMS
  const tabItems = [
    {
      key: 'update',
      label: (
        <span>
          <RocketOutlined /> Cập nhật phần mềm
          {updateInfo?.hasUpdate && (
            <span style={{
              marginLeft: 8,
              background: '#ff4d4f',
              color: '#fff',
              borderRadius: 10,
              padding: '1px 8px',
              fontSize: 11,
            }}>NEW</span>
          )}
        </span>
      ),
      children: (
        <div>
          {/* Current version + check */}
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Phiên bản hiện tại"
                  value={`v${currentVersion}`}
                  prefix={<RocketOutlined />}
                  valueStyle={{ color: '#1890ff' }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Phiên bản mới nhất"
                  value={updateInfo ? `v${updateInfo.latestVersion}` : 'Chưa kiểm tra'}
                  prefix={<CloudDownloadOutlined />}
                  valueStyle={{ color: updateInfo?.hasUpdate ? '#52c41a' : '#8c8c8c' }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Số lần cập nhật"
                  value={updateHistory.length}
                  prefix={<HistoryOutlined />}
                  valueStyle={{ color: '#722ed1' }}
                />
              </Card>
            </Col>
          </Row>

          {/* Update status */}
          {updateInfo?.hasUpdate ? (
            <Alert
              message={`Có bản cập nhật mới: v${updateInfo.latestVersion}`}
              description={
                <div>
                  {updateInfo.releaseNotes && <p>{updateInfo.releaseNotes}</p>}
                  <p>Ngày phát hành: {dayjs(updateInfo.publishedAt).format('DD/MM/YYYY HH:mm')}</p>
                  {updateInfo.downloadSize > 0 && (
                    <p>Kích thước: {(updateInfo.downloadSize / 1024 / 1024).toFixed(1)} MB</p>
                  )}
                </div>
              }
              type="success"
              showIcon
              icon={<CheckCircleOutlined />}
              style={{ marginBottom: 24 }}
              action={
                <Button
                  type="primary"
                  icon={<CloudDownloadOutlined />}
                  onClick={handleDownloadUpdate}
                  loading={downloading}
                  size="large"
                >
                  Cập nhật ngay
                </Button>
              }
            />
          ) : updateInfo && !updateInfo.hasUpdate ? (
            <Alert
              message="Bạn đang dùng phiên bản mới nhất!"
              type="info"
              showIcon
              icon={<CheckCircleOutlined />}
              style={{ marginBottom: 24 }}
            />
          ) : null}

          {/* Actions */}
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={12}>
              <Button
                type="primary"
                icon={<SyncOutlined spin={checkingUpdate} />}
                onClick={() => handleCheckUpdate(false)}
                size="large"
                loading={checkingUpdate}
                block
                style={{ height: 60 }}
              >
                Kiểm tra cập nhật
              </Button>
            </Col>
            <Col span={12}>
              <Button
                icon={<CloudDownloadOutlined />}
                onClick={handleDownloadUpdate}
                size="large"
                loading={downloading}
                block
                style={{ height: 60 }}
              >
                Tải và cập nhật thủ công
              </Button>
            </Col>
          </Row>

          {/* Update history */}
          <Divider>Lịch sử cập nhật ({updateHistory.length})</Divider>

          {updateHistory.length > 0 ? (
            <Table
              columns={updateHistoryColumns}
              dataSource={updateHistory}
              rowKey={(r) => r.date}
              pagination={{ pageSize: 10 }}
              size="small"
            />
          ) : (
            <Alert
              message="Chưa có lịch sử cập nhật"
              description="Lịch sử cập nhật sẽ được ghi lại mỗi khi bạn cập nhật phần mềm."
              type="info"
              showIcon
              icon={<HistoryOutlined />}
            />
          )}
        </div>
      ),
    },
    {
      key: 'backup',
      label: (
        <span>
          <FileZipOutlined /> Sao lưu Hệ thống
        </span>
      ),
      children: (
        <div>
          {/* Stats Row */}
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Tổng Backups"
                  value={backups.length}
                  prefix={<FolderOpenOutlined />}
                  valueStyle={{ color: '#3f8600' }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Backup gần nhất"
                  value={backups.length > 0 ? dayjs(backups[0].createdAt).fromNow() : 'Chưa có'}
                  prefix={<ClockCircleOutlined />}
                  valueStyle={{ color: '#1890ff' }}
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card>
                <Statistic
                  title="Tổng dung lượng"
                  value={backups.reduce((sum, b) => sum + b.size, 0) / 1024 / 1024}
                  precision={2}
                  suffix="MB"
                  prefix={<DatabaseOutlined />}
                  valueStyle={{ color: '#cf1322' }}
                />
              </Card>
            </Col>
          </Row>

          {/* Actions */}
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={12}>
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                onClick={handleBackup}
                size="large"
                loading={backupLoading}
                block
                style={{ height: 80, backgroundColor: '#52c41a', borderColor: '#52c41a' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <Text strong style={{ color: 'white', fontSize: 16 }}>Tạo Backup Mới</Text>
                  <Text style={{ color: 'rgba(255, 255, 255, 0.85)', fontSize: 12 }}>
                    Nén toàn bộ ứng dụng thành ZIP
                  </Text>
                </div>
              </Button>
            </Col>
            <Col span={12}>
              <Button
                icon={<ImportOutlined />}
                onClick={handleBrowseAndRestore}
                size="large"
                loading={backupLoading}
                block
                style={{ height: 80 }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <Text strong style={{ fontSize: 16 }}>Khôi phục từ File</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Chọn file ZIP từ bất kỳ đâu
                  </Text>
                </div>
              </Button>
            </Col>
          </Row>

          <Divider>Danh sách Backup ({backups.length})</Divider>

          {backups.length > 0 ? (
            <Table
              columns={backupColumns}
              dataSource={backups}
              rowKey="path"
              pagination={{ pageSize: 10 }}
              size="small"
            />
          ) : (
            <Alert
              message="Chưa có backup nào"
              description="Nhấn nút 'Tạo Backup Mới' để tạo backup đầu tiên."
              type="info"
              showIcon
              icon={<FileZipOutlined />}
            />
          )}
        </div>
      ),
    },
    {
      key: 'data',
      label: (
        <span>
          <DatabaseOutlined /> Dữ liệu Excel
        </span>
      ),
      children: (
        <div>
          <Alert
            message="Xuất/Nhập dữ liệu Excel"
            description="Sao lưu và đồng bộ dữ liệu giữa các máy tính bằng file Excel. Phù hợp cho việc chuyển dữ liệu hoặc backup nhanh."
            type="info"
            showIcon
            style={{ marginBottom: 24 }}
          />

          <Row gutter={16}>
            <Col span={12}>
              <Card
                hoverable
                style={{ height: '100%' }}
                onClick={handleExport}
              >
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <ExportOutlined style={{ fontSize: 48, color: '#1890ff', marginBottom: 16 }} />
                  <Title level={4}>Xuất Dữ liệu</Title>
                  <Paragraph type="secondary">
                    Tạo file Excel chứa toàn bộ dữ liệu (sản phẩm, đơn hàng, khách hàng...)
                  </Paragraph>
                  <Button type="primary" size="large" disabled={loading}>
                    Xuất Excel
                  </Button>
                </div>
              </Card>
            </Col>
            <Col span={12}>
              <Card
                hoverable
                style={{ height: '100%' }}
                onClick={handleImport}
              >
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <ImportOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
                  <Title level={4}>Nhập Dữ liệu</Title>
                  <Paragraph type="secondary">
                    Đọc file Excel và cập nhật dữ liệu vào hệ thống
                  </Paragraph>
                  <Button type="primary" size="large" style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }} disabled={loading}>
                    Nhập Excel
                  </Button>
                </div>
              </Card>
            </Col>
          </Row>

          <Divider />

          <Alert
            message="Lưu ý quan trọng"
            description={
              <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
                <li>File Excel sẽ chứa nhiều sheets tương ứng với các bảng dữ liệu khác nhau</li>
                <li>Dữ liệu nhạy cảm (mật khẩu người dùng) sẽ KHÔNG được xuất ra file</li>
                <li>Khi nhập dữ liệu, hệ thống sẽ tự động xử lý trùng lặp bằng cách cập nhật thay vì tạo mới</li>
                <li>Đảm bảo đóng tất cả ứng dụng Excel trước khi xuất/nhập để tránh lỗi file đang được mở</li>
              </ul>
            }
            type="warning"
            showIcon
          />
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2}>
          <DatabaseOutlined style={{ marginRight: 8 }} />
          Cài đặt Hệ thống
        </Title>
        <Paragraph type="secondary">
          Quản lý backup, sao lưu và khôi phục dữ liệu hệ thống
        </Paragraph>
      </div>

      <Tabs
        defaultActiveKey="update"
        items={tabItems}
        size="large"
        tabBarStyle={{ marginBottom: 24 }}
      />
    </div>
  );
};

export default Settings;

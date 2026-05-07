import { useState, useEffect, lazy, Suspense } from 'react';
import '../App.css';
import {
  Button,
  Card,
  Modal,
  message,
  Badge,
  Space,
  Typography,
  Divider,
  Alert,
  Table,
  Popconfirm,
  Tabs,
  Row,
  Col,
  Statistic,
  Spin,
  Descriptions
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
  RocketOutlined,
  DesktopOutlined,
  ApiOutlined,
  InfoCircleOutlined,
  TeamOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuth } from '../contexts/AuthContext';

const SystemLogsPage = lazy(() => import('./SystemLogs'));
const PermissionsPage = lazy(() => import('./Permissions'));

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
  id: number;
  fromVersion: string;
  toVersion: string;
  updatedAt: string;
  machine?: string;
  notes?: string;
}

interface SystemInfo {
  dbStatus: 'connected' | 'disconnected';
  machineName: string;
  environment: string;
  platform: string;
  appVersion: string;
  nodeVersion: string;
  electronVersion: string;
}

const Settings = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [loading, setLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backups, setBackups] = useState<BackupFile[]>([]);

  // Update states
  const [currentVersion, setCurrentVersion] = useState('...');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState<string | null>(null);
  const [updateHistory, setUpdateHistory] = useState<UpdateHistoryItem[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loadingSystemInfo, setLoadingSystemInfo] = useState(false);
  const [sysInfoError, setSysInfoError] = useState<string | null>(null);

  // Load danh sách backups + version + update history khi component mount
  useEffect(() => {
    loadBackups();
    loadCurrentVersion();
    loadUpdateHistory();
    loadSystemInfo();
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
        setUpdateHistory(result.data as unknown as UpdateHistoryItem[]);
      }
    } catch { }
  };

  const loadSystemInfo = async () => {
    setLoadingSystemInfo(true);
    setSysInfoError(null);
    try {
      if (typeof window.electronAPI?.system?.getInfo !== 'function') {
        setSysInfoError(`window.electronAPI.system.getInfo is not a function (type: ${typeof window.electronAPI?.system?.getInfo})`);
        return;
      }
      const result = await window.electronAPI.system.getInfo();
      if (result.success && result.data) {
        setSystemInfo(result.data as SystemInfo);
      } else {
        setSysInfoError(`IPC failed: ${result?.error || 'no data'}`);
        setSystemInfo(null);
      }
    } catch (e: any) {
      setSysInfoError(`Exception: ${e?.message}`);
      setSystemInfo(null);
    } finally {
      setLoadingSystemInfo(false);
    }
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
            if (!silent) message.info(`Phát hiện bản cập nhật mới: v${result.data.latestVersion} → Đang tải...`);
            setCheckingUpdate(false);
            handleDownloadUpdate();
            return;
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

      // TỰ ĐỘNG download — không cần Modal.confirm
      setDownloading(true);
      message.loading({ content: `🔄 Đang tải v${latestUpdateInfo.latestVersion}... App sẽ tự khởi động lại`, key: 'update', duration: 0 });

      const downloadResult = await window.electronAPI.update.download(latestUpdateInfo.downloadUrl!);

      if (downloadResult.success && downloadResult.data) {
        message.success({
          content: `✅ Tải xong v${downloadResult.data.version}! Đang khởi động lại...`,
          key: 'update',
          duration: 10
        });
      } else {
        message.error({ content: `Lỗi cập nhật: ${downloadResult.error}`, key: 'update' });
        setDownloading(false);
      }
    } catch (error: any) {
      setCheckingUpdate(false);
      message.error(`Lỗi: ${error.message}`);
      setDownloading(false);
    }
  };

  const normalizeVersion = (version?: string) => String(version || '').trim().replace(/^v/i, '');

  const handleRestoreVersion = (version: string) => {
    if (!isAdmin) {
      message.error('Chỉ admin được khôi phục phiên bản');
      return;
    }

    const targetVersion = normalizeVersion(version);
    if (!targetVersion) {
      message.error('Phiên bản khôi phục không hợp lệ');
      return;
    }

    Modal.confirm({
      title: `Khôi phục v${targetVersion}?`,
      icon: <ReloadOutlined style={{ color: '#1677ff' }} />,
      content: (
        <div>
          <p>Ứng dụng sẽ tải release v{targetVersion} từ GitHub, cài đặt và khởi động lại.</p>
          <Alert
            message="Dữ liệu bán hàng, kho và cấu hình hiện tại không bị rollback."
            type="info"
            showIcon
            style={{ marginTop: 12 }}
          />
        </div>
      ),
      okText: `Khôi phục v${targetVersion}`,
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          setRestoringVersion(targetVersion);
          message.loading({
            content: `Đang khôi phục v${targetVersion}... App sẽ tự khởi động lại`,
            key: 'restore-version',
            duration: 0
          });

          const result = await window.electronAPI.update.restoreVersion(targetVersion);

          if (result.success && result.data) {
            message.success({
              content: `Đã tải xong v${result.data.version}. Đang khởi động lại...`,
              key: 'restore-version',
              duration: 10
            });
          } else {
            message.error({ content: `Lỗi khôi phục: ${result.error}`, key: 'restore-version' });
            setRestoringVersion(null);
          }
        } catch (error: any) {
          message.error({ content: `Lỗi: ${error.message}`, key: 'restore-version' });
          setRestoringVersion(null);
        }
      }
    });
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
      title: 'Từ phiên bản',
      dataIndex: 'fromVersion',
      key: 'fromVersion',
      width: 130,
      render: (v: string) => <Text type="secondary">v{v}</Text>,
    },
    {
      title: 'Lên phiên bản',
      dataIndex: 'toVersion',
      key: 'toVersion',
      width: 130,
      render: (v: string) => <Text strong style={{ color: '#52c41a' }}>v{v}</Text>,
    },
    {
      title: 'Thời gian',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (d: string) => dayjs(d).format('DD/MM/YYYY HH:mm'),
    },
    {
      title: 'Máy thực hiện',
      dataIndex: 'machine',
      key: 'machine',
      render: (m: string) => m || '—',
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 180,
      render: (_: any, record: UpdateHistoryItem) => {
        const targetVersion = normalizeVersion(record.toVersion);
        const isCurrentVersion = targetVersion === normalizeVersion(currentVersion);
        const isBusy = downloading || checkingUpdate || restoringVersion !== null;

        return (
          <Button
            icon={<ReloadOutlined />}
            size="small"
            disabled={!isAdmin || !targetVersion || isCurrentVersion || isBusy}
            loading={restoringVersion === targetVersion}
            onClick={() => handleRestoreVersion(targetVersion)}
          >
            Khôi phục v{targetVersion}
          </Button>
        );
      },
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
                downloading ? (
                  <Spin size="small" />
                ) : (
                  <Button
                    type="primary"
                    icon={<CloudDownloadOutlined />}
                    onClick={() => handleDownloadUpdate()}
                    loading={downloading}
                    size="large"
                  >
                    Cập nhật ngay
                  </Button>
                )
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
            <Col span={24}>
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
          </Row>

          {/* Update history */}
          <Divider>Lịch sử cập nhật ({updateHistory.length})</Divider>

          {updateHistory.length > 0 ? (
            <Table
              columns={updateHistoryColumns}
              dataSource={updateHistory}
              rowKey={(r) => r.id}
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
      key: 'sysinfo',
      label: (
        <span>
          <InfoCircleOutlined /> Thông tin hệ thống
        </span>
      ),
      children: (
        <div>
          {loadingSystemInfo ? (
            <div className="page-loading-center"><Spin size="large" /></div>
          ) : systemInfo ? (
            <>
              {/* DB + Machine + Env */}
              <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={8}>
                  <Card>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <ApiOutlined style={{ fontSize: 32, color: systemInfo.dbStatus === 'connected' ? '#52c41a' : '#ff4d4f' }} />
                      <div>
                        <div style={{ fontSize: 12, color: '#8c8c8c' }}>Kết nối Database</div>
                        <div style={{ marginTop: 4 }}>
                          <Badge
                            status={systemInfo.dbStatus === 'connected' ? 'success' : 'error'}
                            text={
                              <Text strong style={{ color: systemInfo.dbStatus === 'connected' ? '#52c41a' : '#ff4d4f' }}>
                                {systemInfo.dbStatus === 'connected' ? 'Đã kết nối' : 'Mất kết nối'}
                              </Text>
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </Card>
                </Col>
                <Col span={8}>
                  <Card>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <DesktopOutlined style={{ fontSize: 32, color: '#1890ff' }} />
                      <div>
                        <div style={{ fontSize: 12, color: '#8c8c8c' }}>Tên máy tính</div>
                        <Text strong style={{ fontSize: 16 }}>{systemInfo.machineName}</Text>
                      </div>
                    </div>
                  </Card>
                </Col>
                <Col span={8}>
                  <Card>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <CheckCircleOutlined style={{ fontSize: 32, color: '#722ed1' }} />
                      <div>
                        <div style={{ fontSize: 12, color: '#8c8c8c' }}>Môi trường</div>
                        <Text strong style={{ fontSize: 16, textTransform: 'capitalize' }}>{systemInfo.environment}</Text>
                      </div>
                    </div>
                  </Card>
                </Col>
              </Row>

              {/* Chi tiết kỹ thuật */}
              <Card title="Chi tiết kỹ thuật" size="small">
                <Descriptions column={2} size="small">
                  <Descriptions.Item label="Phiên bản ứng dụng">
                    <Text strong>v{systemInfo.appVersion}</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Hệ điều hành">
                    {systemInfo.platform}
                  </Descriptions.Item>
                  <Descriptions.Item label="Electron">
                    {systemInfo.electronVersion}
                  </Descriptions.Item>
                  <Descriptions.Item label="Node.js">
                    {systemInfo.nodeVersion}
                  </Descriptions.Item>
                </Descriptions>
              </Card>

              <div style={{ marginTop: 16, textAlign: 'right' }}>
                <Button icon={<SyncOutlined />} onClick={loadSystemInfo} loading={loadingSystemInfo}>
                  Làm mới
                </Button>
              </div>
            </>
          ) : (
            <Alert message="Không thể tải thông tin hệ thống" description={sysInfoError || 'Lỗi không xác định'} type="error" showIcon />
          )}
        </div>
      ),
    },
    {
      key: 'history',
      label: (
        <span>
          <HistoryOutlined /> Lịch sử hệ thống
        </span>
      ),
      children: (
        <Suspense fallback={<div className="page-loading-center"><Spin size="large" /></div>}>
          <SystemLogsPage />
        </Suspense>
      ),
    },
    ...(isAdmin ? [{
      key: 'admin',
      label: (
        <span>
          <TeamOutlined /> Quản trị
        </span>
      ),
      children: (
        <Suspense fallback={<div className="page-loading-center"><Spin size="large" /></div>}>
          <PermissionsPage />
        </Suspense>
      ),
    }] : []),
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2}>
          <DatabaseOutlined style={{ marginRight: 8 }} />
          Cài đặt Hệ thống
        </Title>
        <Paragraph type="secondary">
          Cập nhật phần mềm và theo dõi trạng thái hệ thống
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

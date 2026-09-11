import { Badge, Button, Tooltip } from 'antd';
import { BellOutlined } from '@ant-design/icons';

interface NotificationBellProps {
    count: number;
    active?: boolean;
    onClick: () => void;
}

export default function NotificationBell({ count, active, onClick }: NotificationBellProps) {
    return (
        <Tooltip title="Thông báo" placement="bottom">
            <Badge count={count} size="small" overflowCount={99} offset={[-2, 2]}>
                <Button
                    className={`notification-bell${active ? ' notification-bell--active' : ''}`}
                    type="text"
                    shape="circle"
                    icon={<BellOutlined />}
                    aria-label={count > 0 ? `Thông báo, ${count} mục cần xem hoặc xác nhận` : 'Thông báo'}
                    onClick={onClick}
                />
            </Badge>
        </Tooltip>
    );
}

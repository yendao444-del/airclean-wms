/**
 * AntAppProvider - Patches antd static methods to work with App context
 * 
 * In antd v5 + React 19, static methods like Modal.confirm() and message.success()
 * fail to render DOM elements. This component wraps children with <App> and patches
 * the static methods to use the hook-based versions that work within context.
 * 
 * Usage: Wrap your app with <AntAppProvider> inside <ConfigProvider>
 */
import { App, Modal, message as staticMessage, notification as staticNotification } from 'antd';
import type { ReactNode } from 'react';

// Inner component that uses the hook and patches static methods
function AntAppPatcher({ children }: { children: ReactNode }) {
    const { modal, message, notification } = App.useApp();

    // Patch Modal static methods to use hook-based versions
    Modal.confirm = modal.confirm;
    Modal.info = modal.info;
    Modal.success = modal.success;
    Modal.error = modal.error;
    Modal.warning = modal.warning;

    // Patch message static methods to use hook-based versions
    staticMessage.success = message.success;
    staticMessage.error = message.error;
    staticMessage.warning = message.warning;
    staticMessage.info = message.info;
    staticMessage.loading = message.loading;
    staticMessage.open = message.open;

    // Patch notification static methods
    staticNotification.success = notification.success;
    staticNotification.error = notification.error;
    staticNotification.warning = notification.warning;
    staticNotification.info = notification.info;
    staticNotification.open = notification.open;

    return <>{children}</>;
}

export default function AntAppProvider({ children }: { children: ReactNode }) {
    return (
        <App>
            <AntAppPatcher>
                {children}
            </AntAppPatcher>
        </App>
    );
}

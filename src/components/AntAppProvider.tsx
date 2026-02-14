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

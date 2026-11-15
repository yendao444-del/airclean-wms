// Keep the original Admin login in memory while all business IPCs run as the
// selected employee. Wait for outstanding requests before changing identity.
function createRoleSession({ getSession, setSession, loadUser, toClient, onSwitch = () => {} }) {
  let owner = null;
  let ownerCheckedAt = 0;
  let active = 0;
  let switching = false;
  let idle;
  const authChannels = new Set(['users:login', 'users:logout', 'users:restoreSession']);
  const switchChannels = new Set([...authChannels, 'users:getCurrentSession', 'users:startRolePreview', 'users:stopRolePreview']);
  const sessionFor = user => ({
    id: user.id, username: user.username, role: user.role,
    passwordChangedAt: new Date(user.passwordChangedAt).getTime(),
    mustChangePassword: Boolean(toClient(user).mustChangePassword),
  });
  async function validateOwner(session) {
    if (!session || session.role !== 'admin') throw new Error('Chỉ Admin được đóng vai nhân viên.');
    const user = await loadUser(session.id);
    if (!user || user.status !== 'active' || user.role !== 'admin'
      || (session.passwordChangedAt && new Date(user.passwordChangedAt).getTime() !== session.passwordChangedAt)
      || toClient(user).mustChangePassword) {
      throw new Error('Phiên Admin không còn hợp lệ. Vui lòng đăng nhập lại.');
    }
    return user;
  }
  async function start(id) {
    const admin = owner || getSession();
    await validateOwner(admin);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Hãy chọn một tài khoản nhân viên thật.');
    const user = await loadUser(id);
    if (!user || user.status !== 'active' || !['manager', 'staff', 'viewer'].includes(user.role)) {
      throw new Error('Tài khoản được chọn không còn hoạt động hoặc không hợp lệ.');
    }
    owner = admin;
    ownerCheckedAt = Date.now();
    setSession(sessionFor(user));
    onSwitch({ action: 'start', admin, user });
    return { success: true, data: toClient(user) };
  }
  async function stop() {
    const admin = owner || getSession();
    const user = await validateOwner(admin);
    const previous = getSession();
    setSession(sessionFor(user));
    owner = null;
    onSwitch({ action: 'stop', admin, user: previous });
    return { success: true, data: toClient(user) };
  }
  async function run(channel, handler) {
    if (switching) throw new Error('Đang chuyển tài khoản. Vui lòng thử lại sau giây lát.');
    if (switchChannels.has(channel)) {
      switching = true;
      let timer;
      try {
        if (active) await new Promise((resolve, reject) => {
          idle = resolve;
          timer = setTimeout(() => reject(new Error('Còn thao tác đang xử lý. Hãy chờ hoàn tất rồi đổi tài khoản.')), 30000);
        });
        // Reload/logout use the original login and never remember an employee
        // identity using the Admin's token. Restart starts with no role session.
        if (authChannels.has(channel) && owner) {
          setSession(owner);
          owner = null;
        }
        return await handler();
      } finally {
        clearTimeout(timer);
        idle = null;
        switching = false;
      }
    }
    active++;
    try {
      if (owner && Date.now() - ownerCheckedAt > 10000) {
        try { await validateOwner(owner); ownerCheckedAt = Date.now(); }
        catch (error) { owner = null; setSession(null); throw error; }
      }
      return await handler();
    } finally {
      active--;
      if (!active) idle?.();
    }
  }
  return { run, start, stop, isActive: () => Boolean(owner), getOwnerUsername: () => owner?.username || '' };
}

module.exports = { createRoleSession };

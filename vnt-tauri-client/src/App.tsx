import {useEffect, useRef, useState, type MutableRefObject, type ReactNode} from 'react';
import {AnimatePresence, motion} from 'motion/react';
import {Copy, Home, Minus, Network, Settings, Square, Terminal, X} from 'lucide-react';
import {getCurrentWindow} from '@tauri-apps/api/window';
import type {AppSnapshot, CoreDevice, NetworkConfig, TabType, ThemeMode, ThemePreference} from './types';
import {BottomNav} from './components/BottomNav';
import {HomeTab} from './components/HomeTab';
import {NetworkTab} from './components/NetworkTab';
import {SettingsTab} from './components/SettingsTab';
import {
  connectConfig,
  defaultConfig,
  deleteConfig,
  disconnectConfig,
  getNetworkOverview,
  loadAppState,
  saveConfig,
  savePreferences,
  setAndroidSystemBars,
  setTemporaryExit,
} from './lib/vntApi';

const blankSnapshot: AppSnapshot = {
  configs: [],
  preferences: {
    autoConnectItemKey: '',
    autoStart: false,
    closeToTray: false,
  },
  connections: [],
  appLogs: [],
  coreAvailable: true,
  coreVersion: 'embedded',
};

const forceTunConfig = (config: NetworkConfig): NetworkConfig => ({
  ...config,
  coreMode: 'tun',
});

const forceTunSnapshot = (state: AppSnapshot): AppSnapshot => ({
  ...state,
  configs: state.configs.map(forceTunConfig),
  connections: state.connections.map((connection) => ({
    ...connection,
    coreMode: 'tun',
  })),
});

const preferredRunKey = (state: AppSnapshot, previous = '') => {
  if (previous && state.configs.some((config) => config.itemKey === previous)) return previous;
  const connected = state.connections.find(isRunningConnection);
  if (connected && state.configs.some((config) => config.itemKey === connected.itemKey)) {
    return connected.itemKey;
  }
  const autoConnectKey = state.preferences.autoConnectItemKey;
  if (autoConnectKey && state.configs.some((config) => config.itemKey === autoConnectKey)) {
    return autoConnectKey;
  }
  return state.configs[0]?.itemKey || '';
};

const navItems = [
  {id: 'home' as const, label: '总览', description: '本机与连接', icon: Home},
  {id: 'network' as const, label: '设备', description: '虚拟网络', icon: Network},
  {id: 'settings' as const, label: '设置', description: '全部参数', icon: Settings},
];

const tabOrder: TabType[] = ['home', 'network', 'settings'];

const TEMPORARY_EXIT_RECONNECT_GRACE_MS = 15000;

const getSystemThemeMode = (): ThemeMode => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const getInitialThemePreference = (): ThemePreference => {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem('vnt-theme-mode');
  return stored === 'system' || stored === 'dark' || stored === 'light' ? stored : 'system';
};

type RefreshOptions = {
  updateStatus?: boolean;
};

export default function App() {
  const [currentTab, setCurrentTab] = useState<TabType>('home');
  const previousTabRef = useRef<TabType>('home');
  const [themePreference, setThemePreference] = useState<ThemePreference>(
    getInitialThemePreference,
  );
  const [systemThemeMode, setSystemThemeMode] = useState<ThemeMode>(getSystemThemeMode);
  const [snapshot, setSnapshot] = useState<AppSnapshot>(blankSnapshot);
  const [draft, setDraft] = useState<NetworkConfig>(() => defaultConfig());
  const [selectedKey, setSelectedKey] = useState('');
  const [selectedRunKey, setSelectedRunKey] = useState('');
  const [connectionPendingKey, setConnectionPendingKey] = useState('');
  const [statusMessage, setStatusMessage] = useState('正在载入配置...');
  const [logsOpen, setLogsOpen] = useState(false);
  const [deviceDetailsOpen, setDeviceDetailsOpen] = useState(false);
  const temporaryExitMissesRef = useRef<Record<string, number>>({});

  const selectedConfig =
    snapshot.configs.find((config) => config.itemKey === selectedKey) ||
    snapshot.configs[0] ||
    null;
  const effectiveThemeMode =
    themePreference === 'system' ? systemThemeMode : themePreference;

  const refresh = async ({updateStatus = true}: RefreshOptions = {}) => {
    const state = forceTunSnapshot(await loadAppState());
    setSnapshot(state);
    if (!selectedKey && state.configs[0]) {
      setSelectedKey(state.configs[0].itemKey);
      setDraft(state.configs[0]);
    }
    setSelectedRunKey((previous) => {
      return preferredRunKey(state, previous);
    });
    if (state.configs.length === 0) {
      setDraft((previous) => (previous.itemKey ? previous : defaultConfig()));
    }
    if (updateStatus) {
      setStatusMessage(state.coreAvailable ? '嵌入式内核就绪' : '嵌入式内核不可用');
    }
  };

  useEffect(() => {
    refresh().catch((error) => setStatusMessage(String(error)));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = () => setSystemThemeMode(media.matches ? 'dark' : 'light');

    syncTheme();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', syncTheme);
      return () => media.removeEventListener('change', syncTheme);
    }

    media.addListener(syncTheme);
    return () => media.removeListener(syncTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveThemeMode;
    document.documentElement.style.colorScheme = effectiveThemeMode;
    window.localStorage.setItem('vnt-theme-mode', themePreference);
  }, [effectiveThemeMode, themePreference]);

  useEffect(() => {
    setAndroidSystemBars(effectiveThemeMode, logsOpen || deviceDetailsOpen).catch(() => undefined);
  }, [deviceDetailsOpen, effectiveThemeMode, logsOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (snapshot.connections.length > 0) {
        refresh({updateStatus: false}).catch((error) => setStatusMessage(String(error)));
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [snapshot.connections.length]);

  useEffect(() => {
    const exitConnections = snapshot.connections.filter((connection) =>
      Boolean(connection.temporaryExitIp),
    );
    const exitKeys = new Set(exitConnections.map((connection) => connection.itemKey));
    for (const key of Object.keys(temporaryExitMissesRef.current)) {
      if (!exitKeys.has(key)) delete temporaryExitMissesRef.current[key];
    }
    if (exitConnections.length === 0) return;

    let cancelled = false;
    const restoreOrdinaryConnection = async (itemKey: string, exitName: string) => {
      setConnectionPendingKey(itemKey);
      setStatusMessage(`出口设备 ${exitName} 已离线，正在恢复普通连接...`);
      try {
        const state = await setTemporaryExit(itemKey, null);
        if (cancelled) return;
        temporaryExitMissesRef.current[itemKey] = 0;
        setSnapshot(forceTunSnapshot(state));
        setStatusMessage('已恢复普通连接');
      } catch (error) {
        if (!cancelled) {
          setStatusMessage(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) {
          setConnectionPendingKey((current) => (current === itemKey ? '' : current));
        }
      }
    };

    const checkTemporaryExits = async () => {
      if (connectionPendingKey) return;

      for (const connection of exitConnections) {
        const exitIp = connection.temporaryExitIp;
        if (!exitIp) continue;
        const startedAt = Date.parse(connection.startedAt || '');
        const inReconnectGrace =
          Number.isFinite(startedAt) &&
          Date.now() - startedAt < TEMPORARY_EXIT_RECONNECT_GRACE_MS;

        try {
          if (connection.status === 'connecting' || inReconnectGrace) {
            continue;
          }

          if (connection.status !== 'connected') {
            await restoreOrdinaryConnection(connection.itemKey, connection.temporaryExitName || exitIp);
            break;
          }

          const overview = await getNetworkOverview(connection.coreMode, connection.itemKey);
          if (cancelled || overview.error) continue;

          const exitDevice = overview.devices.find((device) => device.virtualIp === exitIp);
          if (exitDevice && isCoreDeviceOnline(exitDevice)) {
            temporaryExitMissesRef.current[connection.itemKey] = 0;
            continue;
          }

          const misses = exitDevice
            ? 2
            : (temporaryExitMissesRef.current[connection.itemKey] || 0) + 1;
          temporaryExitMissesRef.current[connection.itemKey] = misses;
          if (misses < 2) continue;

          const exitName = connection.temporaryExitName || exitIp;
          await restoreOrdinaryConnection(connection.itemKey, exitName);
          break;
        } catch {
          // 查询失败时不切换，避免短暂的命令端口抖动误取消出口。
        }
      }
    };

    void checkTemporaryExits();
    const timer = window.setInterval(checkTemporaryExits, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    connectionPendingKey,
    snapshot.connections
      .map(
        (connection) =>
          `${connection.itemKey}:${connection.status}:${connection.coreMode}:${connection.temporaryExitIp || ''}:${connection.temporaryExitName || ''}`,
      )
      .join('|'),
  ]);

  const selectConfig = (key: string) => {
    setSelectedKey(key);
    const config = snapshot.configs.find((item) => item.itemKey === key);
    if (config) setDraft(forceTunConfig(config));
  };

  const saveDraft = async () => {
    const normalizedDraft = forceTunConfig(draft);
    const state = forceTunSnapshot(await saveConfig(normalizedDraft));
    setSnapshot(state);
    const saved =
      state.configs.find((item) => item.itemKey === normalizedDraft.itemKey) ||
      state.configs[state.configs.length - 1];
    if (saved) {
      setSelectedKey(saved.itemKey);
      setDraft(saved);
      setSelectedRunKey(saved.itemKey);
      setStatusMessage(`已保存配置：${saved.configName}`);
    }
  };

  const createDraft = () => {
    const next = defaultConfig();
    next.configName = `新组网 ${snapshot.configs.length + 1}`;
    setSelectedKey('');
    setDraft(next);
    setCurrentTab('settings');
  };

  const removeConfig = async (itemKey: string) => {
    const state = forceTunSnapshot(await deleteConfig(itemKey));
    setSnapshot(state);
    const next =
      state.configs.find((item) => item.itemKey === selectedKey) ||
      state.configs[0] ||
      defaultConfig();
    setSelectedKey(next.itemKey || '');
    setDraft(next);
    if (selectedRunKey === itemKey) {
      setSelectedRunKey(preferredRunKey(state));
    }
    setStatusMessage('配置已删除');
  };

  const toggleSelectedConnections = async () => {
    if (!selectedRunKey) {
      setStatusMessage('请先选择要启动的配置');
      return;
    }
    if (connectionPendingKey) return;

    const connection = snapshot.connections.find((c) => c.itemKey === selectedRunKey);
    const config = snapshot.configs.find((item) => item.itemKey === selectedRunKey);
    const isRunning = connection ? isRunningConnection(connection) : false;
    let state = snapshot;

    setConnectionPendingKey(selectedRunKey);
    try {
      if (isRunning) {
        setStatusMessage('正在断开连接...');
        state = await disconnectConfig(selectedRunKey);
        setStatusMessage('未运行');
      } else {
        setStatusMessage('正在启动连接...');
        if (config && config.coreMode !== 'tun') {
          await saveConfig(forceTunConfig(config));
        }
        state = await connectConfig(selectedRunKey);
        setStatusMessage('已启动连接');
      }

      setSnapshot(forceTunSnapshot(state));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
      try {
        setSnapshot(forceTunSnapshot(await loadAppState()));
      } catch {
        // 保留原始错误提示，日志刷新失败不覆盖启动失败原因。
      }
    } finally {
      setConnectionPendingKey('');
    }
  };

  const handleTemporaryExit = async (
    itemKey: string,
    device?: {ip: string; name: string} | null,
  ) => {
    if (connectionPendingKey) return;
    const connection = snapshot.connections.find((item) => item.itemKey === itemKey);
    if (!connection || connection.status !== 'connected') {
      setStatusMessage('请先启动连接');
      return;
    }

    setConnectionPendingKey(itemKey);
    try {
      setStatusMessage(device ? '正在切换临时出口...' : '正在取消临时出口...');
      const state = await setTemporaryExit(itemKey, device || null);
      setSnapshot(forceTunSnapshot(state));
      setSelectedRunKey(itemKey);
      setStatusMessage(device ? `临时出口：${device.name || device.ip}` : '已取消临时出口');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setConnectionPendingKey('');
    }
  };

  const handleSavePreferences = async (preferences: AppSnapshot['preferences']) => {
    const state = forceTunSnapshot(await savePreferences(preferences));
    setSnapshot(state);
    setStatusMessage('应用设置已保存');
  };

  return (
    <div data-theme={effectiveThemeMode} className="vnt-app-shell h-screen w-screen overflow-hidden bg-vnt-bg font-sans text-slate-950 supports-[height:100dvh]:h-[100dvh]">
      <div className="grid h-full w-full grid-rows-[var(--vnt-mobile-titlebar-height)_minmax(0,1fr)] overflow-hidden lg:grid-rows-[44px_minmax(0,1fr)]">
        <TitleBar onShowLogs={() => setLogsOpen(true)} />
        <div className="relative flex min-h-0 w-full overflow-hidden">
        <DesktopNav
          currentTab={currentTab}
          onChangeTab={setCurrentTab}
          snapshot={snapshot}
          statusMessage={statusMessage}
          onShowLogs={() => setLogsOpen(true)}
        />
        <main className="relative h-full min-w-0 flex-1 overflow-hidden">
          <AnimatedPage tab={currentTab} previousTabRef={previousTabRef}>
            {currentTab === 'home' && (
              <HomeTab
                snapshot={snapshot}
                selectedKey={selectedRunKey}
                onSelectConfig={setSelectedRunKey}
                onCreateConfig={createDraft}
                onToggleConnect={toggleSelectedConnections}
                onSetTemporaryExit={handleTemporaryExit}
                connectionPending={Boolean(selectedRunKey) && connectionPendingKey === selectedRunKey}
              />
            )}
            {currentTab === 'network' && (
              <NetworkTab
                snapshot={snapshot}
                onRefresh={refresh}
                onDetailsOpenChange={setDeviceDetailsOpen}
              />
            )}
            {currentTab === 'settings' && (
              <SettingsTab
                snapshot={snapshot}
                draft={draft}
                setDraft={setDraft}
                selectedKey={selectedKey}
                onSelectConfig={selectConfig}
                onCreateConfig={createDraft}
                onSave={saveDraft}
                onDelete={removeConfig}
                onSavePreferences={handleSavePreferences}
                themePreference={themePreference}
                effectiveThemeMode={effectiveThemeMode}
                onChangeThemePreference={setThemePreference}
              />
            )}
          </AnimatedPage>
        </main>
        <div className="absolute inset-x-0 bottom-0 z-30 lg:hidden">
          <BottomNav currentTab={currentTab} onChangeTab={setCurrentTab} />
        </div>
        <RunLogModal
          open={logsOpen}
          snapshot={snapshot}
          statusMessage={statusMessage}
          onClose={() => setLogsOpen(false)}
        />
        </div>
      </div>
    </div>
  );
}

function TitleBar({onShowLogs}: {onShowLogs: () => void}) {
  const [isMaximized, setIsMaximized] = useState(false);
  const isTauriRuntime = () => '__TAURI_INTERNALS__' in window;
  const mobileRuntime = isMobileRuntime();

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;
    const appWindow = getCurrentWindow();
    const syncMaximized = async () => {
      const maximized = await appWindow.isMaximized();
      if (!disposed) setIsMaximized(maximized);
    };

    void syncMaximized();
    void appWindow.onResized(syncMaximized).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const runWindowAction = async (action: 'minimize' | 'maximize' | 'close') => {
    if (!isTauriRuntime()) return;
    const appWindow = getCurrentWindow();
    if (action === 'minimize') await appWindow.minimize();
    if (action === 'maximize') {
      const maximized = await appWindow.isMaximized();
      if (maximized) await appWindow.unmaximize();
      else await appWindow.maximize();
      setIsMaximized(!maximized);
    }
    if (action === 'close') await appWindow.close();
  };

  return (
    <header
      data-tauri-drag-region="deep"
      className="vnt-titlebar z-50 grid h-[var(--vnt-mobile-titlebar-height)] shrink-0 cursor-default select-none grid-cols-[minmax(0,1fr)_auto] bg-vnt-bg lg:h-11 lg:grid-cols-[248px_minmax(0,1fr)_auto]"
    >
      <div
        className="flex min-w-0 items-center bg-vnt-bg px-5 pt-[var(--vnt-mobile-titlebar-safe-top)] lg:px-0 lg:pl-6 lg:pt-0"
      >
        <span className="truncate text-[17px] font-black text-slate-800 lg:text-[15px] lg:font-bold lg:text-slate-700">VNT Mesh</span>
      </div>
      <div className="hidden min-w-0 bg-vnt-bg lg:block" />
      <div className="flex h-full items-center gap-1 pr-3 lg:items-stretch lg:gap-0 lg:pr-0">
        <button
          type="button"
          aria-label="运行日志"
          title="运行日志"
          onClick={onShowLogs}
          className="grid h-9 w-9 place-items-center rounded-full text-slate-500 transition hover:bg-black/[0.04] hover:text-vnt-primary active:scale-[0.98] lg:hidden"
        >
          <Terminal className="h-4.5 w-4.5" strokeWidth={2.35} />
        </button>
        <div className={`${mobileRuntime ? 'hidden' : 'flex'} h-full items-stretch`}>
          <WindowButton label="最小化" onClick={() => void runWindowAction('minimize')}>
            <Minus className="h-4 w-4" />
          </WindowButton>
          <WindowButton label={isMaximized ? '还原' : '最大化'} onClick={() => void runWindowAction('maximize')}>
            {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </WindowButton>
          <WindowButton label="关闭" danger onClick={() => void runWindowAction('close')}>
            <X className="h-4 w-4" />
          </WindowButton>
        </div>
      </div>
    </header>
  );
}

function getRuntimePlatform() {
  const value = typeof window !== 'undefined' ? (window as any).__TAURI_INTERNALS__?.metadata?.platform : '';
  return typeof value === 'string' ? value.toLowerCase() : '';
}

function isMobileRuntime() {
  const platform = getRuntimePlatform();
  if (platform === 'android' || platform === 'ios') return true;
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function WindowButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-full w-12 place-items-center text-slate-500 transition ${
        danger ? 'hover:bg-red-500 hover:text-white' : 'hover:bg-black/[0.04] hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

function DesktopNav({
  currentTab,
  onChangeTab,
  snapshot,
  statusMessage,
  onShowLogs,
}: {
  currentTab: TabType;
  onChangeTab: (tab: TabType) => void;
  snapshot: AppSnapshot;
  statusMessage: string;
  onShowLogs: () => void;
}) {
  const hasConnection = snapshot.connections.some(isRunningConnection);
  const statusText = hasConnection ? '运行中' : snapshot.coreAvailable ? '未运行' : statusMessage;

  return (
    <nav className="z-30 hidden h-full w-[248px] shrink-0 flex-col overflow-hidden bg-vnt-bg lg:flex">
      <div className="flex-1 px-4 py-5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChangeTab(item.id)}
              className={`group relative mb-2 flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition ${
                active
                  ? 'bg-black/[0.035] text-slate-950'
                  : 'text-slate-500 hover:bg-black/[0.025] hover:text-slate-800'
              }`}
            >
              <span
                className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-vnt-primary transition ${
                  active ? 'opacity-100' : 'opacity-0'
                }`}
              />
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center transition ${
                  active ? 'text-vnt-primary' : 'text-slate-400 group-hover:text-slate-600'
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.6 : 2.2} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-black leading-5">{item.label}</span>
                <span className="mt-0.5 block truncate text-[13px] font-bold leading-4 text-slate-400">
                  {item.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="shrink-0 p-4 pt-2">
        <button
          type="button"
          onClick={onShowLogs}
          className="w-full rounded-xl bg-black/[0.025] p-3 text-left transition hover:bg-black/[0.04]"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs font-black text-slate-500">内核状态</span>
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                hasConnection ? 'bg-vnt-primary' : snapshot.coreAvailable ? 'bg-slate-400' : 'bg-amber-500'
              }`}
            />
          </div>
          <div className="truncate text-sm font-black leading-5 text-slate-950">
            {statusText}
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2 text-xs font-bold text-slate-400">
            <span>版本 {snapshot.coreVersion}</span>
            <span>查看日志</span>
          </div>
        </button>
      </div>
    </nav>
  );
}

function RunLogModal({
  open,
  snapshot,
  statusMessage,
  onClose,
}: {
  open: boolean;
  snapshot: AppSnapshot;
  statusMessage: string;
  onClose: () => void;
}) {
  const logText = buildLogText(snapshot, statusMessage);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/42 p-4 backdrop-blur-sm"
          initial={{opacity: 0}}
          animate={{opacity: 1}}
          exit={{opacity: 0}}
          onMouseDown={onClose}
        >
          <motion.section
            className="flex max-h-[82vh] w-full max-w-3xl min-w-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            initial={{opacity: 0, scale: 0.98, y: 10}}
            animate={{opacity: 1, scale: 1, y: 0}}
            exit={{opacity: 0, scale: 0.98, y: 10}}
            transition={{duration: 0.16}}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                  <Terminal className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-black text-slate-950">运行日志</h2>
                  <p className="mt-0.5 truncate text-xs font-bold text-slate-400">启动命令、错误和最近输出</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <pre className="min-h-[320px] overflow-auto whitespace-pre-wrap bg-[#0f172a] p-5 font-mono text-xs leading-6 text-slate-100">
              {logText}
            </pre>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function buildLogText(snapshot: AppSnapshot, statusMessage: string) {
  const appLogs =
    snapshot.appLogs && snapshot.appLogs.length > 0
      ? snapshot.appLogs.slice(-120).join('\n')
      : '暂无应用级日志';

  if (snapshot.connections.length === 0) {
    return `VNT 内核版本：${snapshot.coreVersion}\n\n当前没有运行中的连接。\n\n状态：${statusMessage}\n\n应用日志：\n${appLogs}`;
  }

  const connectionLogs = snapshot.connections
    .map((connection) => {
      const command = connection.commandPreview.length > 0 ? connection.commandPreview.join(' ') : '无命令记录';
      const logs = connection.logs.length > 0 ? connection.logs.slice(-220).join('\n') : '暂无输出';
      const error = connection.lastError ? `\n\n最近错误：\n${connection.lastError}` : '';
      return [
        `配置：${connection.configName}`,
        '模式：TUN',
        `状态：${displayConnectionStatus(connection.status)}`,
        `PID：${connection.pid || '-'}`,
        `临时出口：${connection.temporaryExitIp ? `${connection.temporaryExitName || connection.temporaryExitIp} (${connection.temporaryExitIp})` : '-'}`,
        `启动时间：${connection.startedAt || '-'}`,
        '',
        '启动命令：',
        command,
        error,
        '',
        '最近输出：',
        logs,
      ].join('\n');
    })
    .join('\n\n' + '-'.repeat(72) + '\n\n');

  return `VNT 内核版本：${snapshot.coreVersion}\n\n${connectionLogs}\n\n${'-'.repeat(72)}\n\n应用日志：\n${appLogs}`;
}

function displayConnectionStatus(status: string) {
  if (status === 'connecting') return '连接中';
  if (status === 'connected') return '已连接';
  if (status === 'stopped') return '已停止';
  if (status === 'error') return '异常';
  return status || '未知';
}

function isRunningConnection(connection: {status: string}) {
  return connection.status === 'connecting' || connection.status === 'connected';
}

function isCoreDeviceOnline(device: CoreDevice) {
  const status = (device.status || '').trim().toLowerCase();
  return status !== 'offline' && status !== 'stopped' && status !== 'error';
}

function AnimatedPage({
  tab,
  previousTabRef,
  children,
}: {
  tab: TabType;
  previousTabRef: MutableRefObject<TabType>;
  children: ReactNode;
}) {
  const previousTab = previousTabRef.current;
  const direction = Math.sign(tabOrder.indexOf(tab) - tabOrder.indexOf(previousTab)) || 1;
  const desktopLayout = useDesktopLayout();

  useEffect(() => {
    previousTabRef.current = tab;
  }, [previousTabRef, tab]);

  return (
    <AnimatePresence custom={direction} initial={false} mode="popLayout">
      <motion.div
        key={tab}
        custom={direction}
        variants={desktopLayout ? pageFadeVariants : pageSlideVariants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={desktopLayout ? pageFadeTransition : pageSlideTransition}
        className="vnt-page-surface absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-vnt-bg"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function useDesktopLayout() {
  const [desktopLayout, setDesktopLayout] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(min-width: 1024px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(min-width: 1024px)');
    const sync = () => setDesktopLayout(media.matches);
    sync();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync);
      return () => media.removeEventListener('change', sync);
    }
    media.addListener(sync);
    return () => media.removeListener(sync);
  }, []);

  return desktopLayout;
}

const pageSlideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? '100%' : '-100%',
  }),
  center: {
    x: 0,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? '-100%' : '100%',
  }),
};

const pageFadeVariants = {
  enter: {
    x: 0,
    opacity: 0,
  },
  center: {
    x: 0,
    opacity: 1,
  },
  exit: {
    x: 0,
    opacity: 0,
  },
};

const pageSlideTransition = {
  x: {type: 'spring', stiffness: 320, damping: 36, mass: 0.92},
} as const;

const pageFadeTransition = {
  opacity: {duration: 0.16, ease: 'easeOut'},
} as const;

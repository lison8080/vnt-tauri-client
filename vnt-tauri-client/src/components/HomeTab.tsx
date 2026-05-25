import {useEffect, useMemo, useRef, useState} from 'react';
import {AnimatePresence, LayoutGroup, motion} from 'motion/react';
import {PlaneTakeoff, Plus, Power, RadioTower, Router} from 'lucide-react';
import type {AppSnapshot, CoreDevice, NetworkOverview} from '../types';
import {getNetworkOverview} from '../lib/vntApi';
import {copyText} from '../lib/clipboard';

interface HomeTabProps {
  snapshot: AppSnapshot;
  selectedKey: string;
  connectionPending: boolean;
  onSelectConfig: (itemKey: string) => void;
  onCreateConfig: () => void;
  onToggleConnect: () => Promise<void>;
  onSetTemporaryExit: (
    itemKey: string,
    device?: {ip: string; name: string} | null,
  ) => Promise<void>;
}

export function HomeTab({
  snapshot,
  selectedKey,
  connectionPending,
  onSelectConfig,
  onCreateConfig,
  onToggleConnect,
  onSetTemporaryExit,
}: HomeTabProps) {
  const [overviews, setOverviews] = useState<Record<string, NetworkOverview>>({});
  const [optimisticDisconnectKey, setOptimisticDisconnectKey] = useState('');
  const optimisticDisconnectTimerRef = useRef<number | null>(null);
  const runningConnections = snapshot.connections.filter(isRunningConnection);
  const selectedRunning = selectedKey
    ? runningConnections.some((c) => c.itemKey === selectedKey)
    : false;
  const selectedConfig = snapshot.configs.find((c) => c.itemKey === selectedKey);
  const selectedConnection = runningConnections.find((c) => c.itemKey === selectedKey);
  const selectedConnected = selectedConnection?.status === 'connected';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (runningConnections.length === 0) {
        if (!cancelled) setOverviews({});
        return;
      }

      const entries = await Promise.all(
        runningConnections.map(async (connection) => {
          try {
            return [
              connection.itemKey,
              await getNetworkOverview(connection.coreMode, connection.itemKey),
            ] as const;
          } catch (error) {
            return [
              connection.itemKey,
              {
                info: null,
                devices: [],
                routes: [],
                stats: null,
                error: error instanceof Error ? error.message : String(error),
              },
            ] as const;
          }
        }),
      );
      const nextOverviews = Object.fromEntries(entries) as Record<string, NetworkOverview>;
      if (!cancelled) {
        setOverviews(nextOverviews);
      }
    };
    void load();
    const timer = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningConnections.map((c) => c.itemKey).join('|')]);

  const currentOverview: NetworkOverview | null = selectedKey
    ? (overviews[selectedKey] ?? null)
    : null;

  const onlineDevices = useMemo(
    () => (currentOverview?.devices || []).filter(isDeviceOnline),
    [currentOverview?.devices],
  );
  const primaryIp = currentOverview?.info?.virtualIp || selectedConfig?.virtualIpv4 || '--';
  const isOptimisticallyDisconnecting = Boolean(selectedKey && optimisticDisconnectKey === selectedKey);
  const isDisconnecting = isOptimisticallyDisconnecting || (selectedRunning && connectionPending);
  const isStarting =
    (!selectedRunning && connectionPending) ||
    (selectedRunning && !isDisconnecting && (!selectedConnected || !isOverviewReady(currentOverview)));
  const isConnectedVisual = selectedConnected && !isStarting && !isDisconnecting;
  const visibleDevices =
    !isStarting && selectedConnected && !isDisconnecting ? onlineDevices : [];
  const temporaryExitIp = selectedConnection?.temporaryExitIp || '';
  const temporaryExitName = selectedConnection?.temporaryExitName || temporaryExitIp;
  const powerButtonClass = isStarting
    ? 'border-[#9db0e0] bg-vnt-primary text-white shadow-[0_0_0_12px_rgba(75,112,204,0.12),0_24px_70px_rgba(75,112,204,0.26)] hover:bg-vnt-primary'
    : isConnectedVisual
      ? 'border-emerald-400 bg-emerald-500 text-white shadow-[0_0_0_12px_rgba(16,185,129,0.12),0_24px_70px_rgba(16,185,129,0.26)] hover:bg-emerald-600'
      : 'border-[#4b70cc] bg-vnt-primary text-white hover:bg-[#4265b8]';
  const powerLabel = isStarting
    ? '连接中'
    : (isConnectedVisual ? '已连接' : '启动');
  const layoutTransition = homeLayoutTransition;

  useEffect(() => {
    if (optimisticDisconnectKey && optimisticDisconnectKey !== selectedKey) {
      if (optimisticDisconnectTimerRef.current !== null) {
        window.clearTimeout(optimisticDisconnectTimerRef.current);
        optimisticDisconnectTimerRef.current = null;
      }
      setOptimisticDisconnectKey('');
    }
  }, [optimisticDisconnectKey, selectedKey]);

  useEffect(() => {
    return () => {
      if (optimisticDisconnectTimerRef.current !== null) {
        window.clearTimeout(optimisticDisconnectTimerRef.current);
      }
    };
  }, []);

  const releaseOptimisticDisconnect = (key: string, delay = 760) => {
    if (optimisticDisconnectTimerRef.current !== null) {
      window.clearTimeout(optimisticDisconnectTimerRef.current);
    }
    optimisticDisconnectTimerRef.current = window.setTimeout(() => {
      optimisticDisconnectTimerRef.current = null;
      setOptimisticDisconnectKey((current) => (current === key ? '' : current));
    }, delay);
  };

  const beginOptimisticDisconnect = () => {
    if (selectedKey && selectedRunning && !connectionPending) {
      setOptimisticDisconnectKey(selectedKey);
      releaseOptimisticDisconnect(selectedKey);
    }
  };

  const handleToggleConnect = async () => {
    beginOptimisticDisconnect();
    try {
      await onToggleConnect();
    } finally {
      if (selectedRunning) {
        releaseOptimisticDisconnect(selectedKey);
      }
    }
  };

  const showConnectedSummary = isConnectedVisual || visibleDevices.length > 0;

  return (
    <div className="vnt-app-scroll relative h-full min-w-0 overflow-y-auto px-4 pb-44 pt-4 sm:px-5 lg:overflow-hidden lg:p-6">
      <LayoutGroup id="home-layout">
        <motion.div
          layout
          transition={layoutTransition}
          className={`grid min-h-full min-w-0 justify-items-center lg:h-full ${
            showConnectedSummary
              ? 'items-start pt-2 sm:pt-3 lg:items-center lg:pt-0'
              : 'items-center pt-[11vh] sm:pt-[7vh] lg:pt-0'
          }`}
        >
          <motion.section
            layout
            transition={layoutTransition}
            className="flex w-full max-w-[min(100%,560px)] flex-col items-center gap-6 sm:gap-7 lg:max-w-md lg:gap-8"
          >
          {/* Config selector */}
          <motion.div layout transition={layoutTransition} className="w-full">
            {snapshot.configs.length === 0 ? (
              <motion.button
                layout
                transition={homeLayoutTransition}
                type="button"
                onClick={onCreateConfig}
                className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 text-sm font-black text-slate-500 transition hover:border-[#9db0e0] hover:text-vnt-primary"
              >
                <Plus className="h-5 w-5" />
                新建配置
              </motion.button>
            ) : (
              <motion.div layout transition={homeLayoutTransition} className="flex flex-wrap items-center justify-center gap-2">
                {snapshot.configs.map((config) => {
                  const isSelected = config.itemKey === selectedKey;
                  const isRunning = runningConnections.some((c) => c.itemKey === config.itemKey);
                  return (
                    <motion.div
                      layout
                      transition={layoutTransition}
                      key={config.itemKey}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectConfig(config.itemKey)}
                        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-black transition ${
                          isSelected
                            ? 'bg-slate-950 text-white shadow-sm'
                            : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {isRunning && (
                          <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        )}
                        {config.configName}
                      </button>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </motion.div>

          {/* Big circular power button */}
          <motion.div
            layout="position"
            transition={layoutTransition}
            className="grid h-44 w-44 shrink-0 place-items-center sm:h-52 sm:w-52 lg:h-56 lg:w-56"
          >
            <button
            type="button"
            onPointerDownCapture={beginOptimisticDisconnect}
            onClick={() => void handleToggleConnect()}
            disabled={!selectedKey || connectionPending}
            className={`grid h-full w-full place-items-center rounded-full border-2 text-center transition-[background-color,border-color,box-shadow,color,opacity] duration-300 ease-out active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 ${
              isStarting ? 'vnt-power-breathing' : ''
            } ${powerButtonClass}`}
          >
            <span className="flex flex-col items-center gap-2">
              <Power className={`h-10 w-10 sm:h-12 sm:w-12 ${isStarting ? 'animate-pulse' : ''}`} strokeWidth={2.2} />
              <span className="text-lg font-black tracking-wide sm:text-xl">
                {powerLabel}
              </span>
            </span>
            </button>
          </motion.div>

          {/* Status section */}
          <AnimatePresence initial={false} mode="popLayout" presenceAffectsLayout={false}>
            {selectedConfig && showConnectedSummary && (
              <motion.div
                key="connected-summary"
                layout="position"
                transition={layoutTransition}
                className="w-full space-y-3"
                initial={{opacity: 0, y: 28, scale: 0.98}}
                animate={{opacity: 1, y: 0, scale: 1}}
                exit={{
                  opacity: 0,
                  y: 6,
                  scale: 0.98,
                  transition: {duration: 0.08, ease: [0.22, 1, 0.36, 1]},
                }}
              >
                <ConnectionSummaryBar onlineCount={onlineDevices.length} ipAddress={primaryIp} />
                {visibleDevices.length > 0 && (
                  <motion.div
                    key="online-devices"
                    layout
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                    initial={{opacity: 0, y: 28, scale: 0.98}}
                    animate={{opacity: 1, y: 0, scale: 1}}
                    exit={{opacity: 0, y: 14, scale: 0.98}}
                    transition={homeLayoutTransition}
                  >
                    {temporaryExitIp && (
                      <motion.div
                        layout
                        className="flex items-center justify-between gap-3 border-b border-[#d9e1fb] bg-[#eef2ff] px-4 py-2.5 text-xs font-black text-vnt-primary"
                      >
                        <span className="min-w-0 truncate">
                          临时出口：{temporaryExitName}
                        </span>
                        <button
                          type="button"
                          disabled={connectionPending}
                          onClick={() => void onSetTemporaryExit(selectedKey, null)}
                          className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-vnt-primary ring-1 ring-[#d9e1fb] transition hover:bg-[#f8faff] disabled:opacity-50"
                        >
                          取消
                        </button>
                      </motion.div>
                    )}
                    {visibleDevices.map((device, index) => (
                      <div key={`${device.virtualIp}-${device.name}`}>
                        <DeviceRow
                          device={device}
                          index={index}
                          activeExitIp={temporaryExitIp}
                          disabled={connectionPending}
                          onSetExit={() =>
                            void onSetTemporaryExit(
                              selectedKey,
                              temporaryExitIp === device.virtualIp
                                ? null
                                : {
                                    ip: device.virtualIp,
                                    name: device.name || device.virtualIp,
                                  },
                            )
                          }
                        />
                      </div>
                    ))}
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          </motion.section>
        </motion.div>
      </LayoutGroup>
    </div>
  );
}

function ConnectionSummaryBar({
  onlineCount,
  ipAddress,
}: {
  onlineCount: number;
  ipAddress: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-2 overflow-hidden rounded-2xl border border-slate-200 bg-white text-center shadow-sm">
      <SummaryMetric icon={RadioTower} label="在线设备" value={`${onlineCount}`} />
      <SummaryMetric icon={Router} label="IP 地址" value={ipAddress} copyable compact />
    </div>
  );
}

function SummaryMetric({
  icon: Icon,
  label,
  value,
  copyable,
  compact,
}: {
  icon: typeof RadioTower;
  label: string;
  value: string;
  copyable?: boolean;
  compact?: boolean;
}) {
  const metric = <MetricValue value={value} compact={compact} />;

  return (
    <div className="min-w-0 border-r border-slate-200 px-3 py-4 last:border-r-0">
      <div className="mb-2 flex items-center justify-center gap-2 text-[11px] font-black tracking-[0.14em] text-slate-400">
        <Icon className="h-4 w-4 text-slate-500" />
        {label}
      </div>
      {copyable ? (
        <button
          type="button"
          title="点击复制 IP"
          onClick={() => void copyText(value)}
          className="flex h-9 w-full min-w-0 cursor-copy appearance-none items-center justify-center p-0 text-center text-slate-950 transition hover:text-vnt-primary"
        >
          {metric}
        </button>
      ) : (
        <div className="flex h-9 w-full min-w-0 items-center justify-center text-center text-slate-950">
          {metric}
        </div>
      )}
    </div>
  );
}

function MetricValue({value, compact}: {value: string; compact?: boolean}) {
  return (
    <span
      className={`block min-w-0 max-w-full whitespace-nowrap font-mono font-bold leading-none tabular-nums [font-variant-numeric:tabular-nums] [letter-spacing:0] ${
        compact ? 'text-[20px]' : 'text-[22px]'
      }`}
    >
      {value}
    </span>
  );
}

function DeviceRow({
  device,
  index,
  activeExitIp,
  disabled,
  onSetExit,
}: {
  device: CoreDevice;
  index: number;
  activeExitIp: string;
  disabled: boolean;
  onSetExit: () => void;
}) {
  const latency = parseLatency(device.rt);
  const channel = channelPresentation(device);
  const isExit = Boolean(activeExitIp && activeExitIp === device.virtualIp);
  return (
    <motion.div
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
      initial={{opacity: 0, x: -14}}
      animate={{opacity: 1, x: 0}}
      transition={{duration: 0.32, delay: 0.08 + index * 0.055, ease: [0.22, 1, 0.36, 1]}}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-black text-slate-950">{device.name || '未命名设备'}</div>
        <button
          type="button"
          title="点击复制 IP"
          onClick={() => void copyText(device.virtualIp || '')}
          className="mt-0.5 max-w-full cursor-copy truncate font-mono text-xs font-bold text-slate-400 transition hover:text-vnt-primary"
        >
          {device.virtualIp || '--'}
        </button>
      </div>
      <div className="grid grid-cols-[48px_68px_42px] items-center justify-end gap-1.5 min-[520px]:grid-cols-[48px_72px_46px] min-[520px]:gap-2">
        <span className={`inline-flex h-6 items-center justify-center whitespace-nowrap rounded-full border px-2 text-[11px] font-black ${channel.style}`}>
          {channel.label}
        </span>
        <span className={`inline-flex h-6 min-w-[72px] items-center justify-center whitespace-nowrap rounded-full border px-2 font-mono text-xs font-bold tabular-nums ${channel.latencyStyle}`}>
          {formatLatency(latency)}
        </span>
        <button
          type="button"
          disabled={disabled || !device.virtualIp}
          title={isExit ? '取消临时出口' : '设为临时出口'}
          onClick={(event) => {
            event.stopPropagation();
            onSetExit();
          }}
          className={`inline-flex h-6 items-center justify-center whitespace-nowrap rounded-full border px-2 text-[11px] font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${
            isExit
              ? 'border-amber-300 bg-amber-50 text-amber-600'
              : 'border-slate-200 bg-white text-slate-950 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600'
          }`}
        >
          <PlaneTakeoff className="h-3.5 w-3.5" strokeWidth={2.4} />
        </button>
      </div>
    </motion.div>
  );
}

function isOverviewReady(overview: NetworkOverview | null) {
  return Boolean(overview?.info?.virtualIp || overview?.devices.some(isDeviceOnline));
}

function parseLatency(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 9999) return null;
  return parsed;
}

function formatLatency(value: number | null) {
  return value === null ? '--' : `${value} ms`;
}

function isDeviceOnline(device: CoreDevice) {
  const status = (device.status || '').trim().toLowerCase();
  return status !== 'offline' && status !== 'stopped' && status !== 'error';
}

function isRunningConnection(connection: {status: string}) {
  return connection.status === 'connecting' || connection.status === 'connected';
}

function channelPresentation(device: CoreDevice) {
  if (!isDeviceOnline(device)) {
    return {
      label: '离线',
      style: 'border-slate-200 bg-slate-100 text-slate-500',
      latencyStyle: 'border-slate-200 bg-slate-100 text-slate-500',
    };
  }

  const normalized = normalizeChannel(device.natTraversalType);
  if (normalized.includes('p2p')) {
    return {
      label: '直连',
      style: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      latencyStyle: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
  }
  if (normalized.includes('relay')) {
    return {
      label: '中转',
      style: 'border-[#d9e1fb] bg-[#eef2ff] text-vnt-primary',
      latencyStyle: 'border-[#d9e1fb] bg-[#eef2ff] text-vnt-primary',
    };
  }
  if (normalized.includes('local')) {
    return {
      label: '本地',
      style: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      latencyStyle: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
  }

  return {
    label: normalized || '未知',
    style: 'border-slate-200 bg-slate-100 text-slate-600',
    latencyStyle: 'border-slate-200 bg-slate-100 text-slate-600',
  };
}

function normalizeChannel(value: string) {
  return (value || '').trim().toLowerCase().replace(/^server[-_\s]*/, '');
}

const homeLayoutTransition = {
  type: 'spring',
  stiffness: 220,
  damping: 32,
  mass: 0.72,
};

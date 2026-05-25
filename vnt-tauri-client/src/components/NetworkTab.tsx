import {useEffect, useState} from 'react';
import {Activity, Laptop, Router, Search, Server, ShieldCheck, Signal, Users, X} from 'lucide-react';
import type {AppSnapshot, ConnectionView, CoreDevice, CoreRoute, NetworkConfig, NetworkOverview} from '../types';
import {getNetworkOverview} from '../lib/vntApi';
import {copyText} from '../lib/clipboard';

interface NetworkTabProps {
  snapshot: AppSnapshot;
  onRefresh: () => Promise<void>;
  onDetailsOpenChange?: (open: boolean) => void;
}

type UiDevice = CoreDevice & {
  isLocal: boolean;
  groupKey: string;
  groupName: string;
  subnet: string;
  route: CoreRoute | null;
};

interface DeviceGroup {
  connection: ConnectionView;
  config?: NetworkConfig;
  overview: NetworkOverview;
  subnet: string;
  devices: UiDevice[];
}

const emptyOverview: NetworkOverview = {
  info: null,
  devices: [],
  routes: [],
  stats: null,
  error: null,
};

export function NetworkTab({snapshot, onRefresh, onDetailsOpenChange}: NetworkTabProps) {
  const [overviews, setOverviews] = useState<Record<string, NetworkOverview>>({});
  const [search, setSearch] = useState('');
  const [selectedDeviceKey, setSelectedDeviceKey] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const activeConnections = snapshot.connections.filter(isRunningConnection);
  const activeSignature = activeConnections.map((connection) => `${connection.itemKey}:${connection.coreMode}`).join('|');

  const loadOverviews = async () => {
    if (activeConnections.length === 0) {
      setOverviews({});
      return;
    }

    const entries = await Promise.all(
      activeConnections.map(async (connection) => {
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
    setOverviews(Object.fromEntries(entries));
    onRefresh().catch(() => undefined);
  };

  useEffect(() => {
    void loadOverviews();
    const timer = window.setInterval(loadOverviews, 3500);
    return () => window.clearInterval(timer);
  }, [activeSignature]);

  const groups: DeviceGroup[] = activeConnections.map((connection) => {
    const config = snapshot.configs.find((item) => item.itemKey === connection.itemKey);
    const overview = overviews[connection.itemKey] || emptyOverview;
    const fallbackIp =
      overview.info?.virtualIp ||
      parseRegisterIp(connection.logs) ||
      config?.virtualIpv4 ||
      '';
    const subnet = subnetLabel(overview.info?.virtualGateway || fallbackIp);
    const localDevice: UiDevice = {
      name: overview.info?.name || config?.deviceName || connection.configName || '本机设备',
      virtualIp: fallbackIp,
      status: overview.info?.connectStatus || 'Online',
      natTraversalType: overview.info ? 'local' : connection.coreMode,
      rt: '0',
      natType: overview.info?.natType || '--',
      publicIps: overview.info?.publicIps || '',
      localIp: overview.info?.localAddr || '',
      ipv6: overview.info?.ipv6Addr || '',
      clientSecret: true,
      currentClientSecret: true,
      wireGuard: false,
      isLocal: true,
      groupKey: connection.itemKey,
      groupName: connection.configName,
      subnet,
      route: null,
    };
    return {
      connection,
      config,
      overview,
      subnet,
      devices: sortDevices([
        localDevice,
        ...overview.devices.map((device) => ({
          ...device,
          isLocal: false,
          groupKey: connection.itemKey,
          groupName: connection.configName,
          subnet,
          route: findDeviceRoute(overview.routes, device.virtualIp),
        })),
      ]),
    };
  });

  const keyword = search.trim().toLowerCase();
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      devices: group.devices.filter((device) => {
        if (!keyword) return true;
        return `${group.connection.configName} ${group.subnet} ${device.name} ${device.virtualIp} ${device.natTraversalType} ${channelPresentation(device).label} ${displayStatus(device.status)}`
          .toLowerCase()
          .includes(keyword);
      }),
    }))
    .filter((group) => group.devices.length > 0 || !keyword);
  const devices = groups.flatMap((group) => group.devices);
  const filteredDevices = filteredGroups.flatMap((group) => group.devices);
  const filteredKeySignature = filteredDevices.map(deviceKey).join('|');

  useEffect(() => {
    if (filteredDevices.length === 0) {
      setSelectedDeviceKey('');
      setDetailsOpen(false);
      return;
    }
    if (!filteredDevices.some((device) => deviceKey(device) === selectedDeviceKey)) {
      setSelectedDeviceKey(deviceKey(filteredDevices[0]));
    }
  }, [filteredKeySignature, selectedDeviceKey]);

  const selectedDevice =
    filteredDevices.find((device) => deviceKey(device) === selectedDeviceKey) || filteredDevices[0] || null;
  const onlineCount = devices.filter((device) => isOnline(device)).length;
  const p2pCount = devices.filter(
    (device) => isOnline(device) && normalizeChannel(device.natTraversalType).includes('p2p'),
  ).length;
  const relayCount = devices.filter(
    (device) => isOnline(device) && normalizeChannel(device.natTraversalType).includes('relay'),
  ).length;
  const traffic = groups.reduce(
    (total, group) => total + (group.overview.stats?.upTotal || 0) + (group.overview.stats?.downTotal || 0),
    0,
  );
  const errors = groups
    .filter((group) => group.overview.error)
    .map((group) => `${group.connection.configName}：${compactError(group.overview.error || '')}`);
  const selectDevice = (device: UiDevice) => {
    setSelectedDeviceKey(deviceKey(device));
    setDetailsOpen(true);
  };

  useEffect(() => {
    onDetailsOpenChange?.(detailsOpen);
    return () => onDetailsOpenChange?.(false);
  }, [detailsOpen, onDetailsOpenChange]);

  return (
    <div className="vnt-app-scroll h-full min-w-0 overflow-y-auto px-4 pb-44 pt-4 sm:px-5 sm:pb-44 sm:pt-5 lg:overflow-hidden lg:p-6">
      <div className="grid min-h-full w-full min-w-0 gap-4 lg:h-full lg:grid-rows-[auto_minmax(0,1fr)]">
        <section className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard icon={Users} label="在线" value={`${onlineCount}`} />
          <SummaryCard icon={Signal} label="直连" value={`${p2pCount}`} />
          <SummaryCard icon={Router} label="中转" value={`${relayCount}`} />
          <SummaryCard icon={Activity} label="流量" value={formatBytes(traffic)} />
        </section>

        <section className="grid min-w-0 overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm lg:min-h-0 lg:overflow-hidden lg:grid-cols-[minmax(340px,0.95fr)_minmax(340px,1fr)]">
          <div className="flex flex-col border-b border-slate-200 lg:min-h-0 lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-200 p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-[#fbfbf8] pl-10 pr-3 text-sm font-bold outline-none transition focus:border-[#9db0e0] focus:bg-white"
                  placeholder="搜索设备或子网"
                />
              </div>
              {errors.length > 0 && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                  {errors.slice(0, 2).join('；')}
                </div>
              )}
            </div>

            <div className="overflow-visible lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {activeConnections.length === 0 ? (
                <EmptyState text="请先在总览中启动一个或多个配置。" />
              ) : filteredDevices.length === 0 ? (
                <EmptyState text="没有匹配设备。" />
              ) : (
                filteredGroups.map((group) => (
                  <section key={group.connection.itemKey} className="border-b border-slate-100 last:border-b-0">
                    <div className="vnt-device-group-header sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-black text-slate-800">{group.connection.configName}</div>
                        <div className="truncate font-mono text-[11px] font-bold text-slate-400">{group.subnet}</div>
                      </div>
                      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-500 ring-1 ring-slate-200">
                        {group.devices.length} 台
                      </span>
                    </div>
                    {group.devices.map((device) => (
                      <div key={deviceKey(device)}>
                        <DeviceRow
                          device={device}
                          selected={deviceKey(device) === deviceKey(selectedDevice)}
                          onSelect={() => selectDevice(device)}
                        />
                      </div>
                    ))}
                  </section>
                ))
              )}
            </div>
          </div>

          <DeviceDetails
            device={selectedDevice}
            className="hidden min-h-[360px] overflow-y-auto bg-[#fbfbf8] p-4 sm:p-5 lg:block lg:min-h-0"
          />
        </section>
        <MobileDeviceDetails
          device={selectedDevice}
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
        />
      </div>
    </div>
  );
}

function SummaryCard({icon: Icon, label, value}: {icon: typeof Users; label: string; value: string}) {
  return (
    <div className="min-h-[82px] rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-black tracking-[0.14em] text-slate-400">
        <Icon className="h-4 w-4 text-slate-500" />
        {label}
      </div>
      <div className="truncate font-mono text-2xl font-black text-slate-950">{value}</div>
    </div>
  );
}

function DeviceRow({
  device,
  selected,
  onSelect,
}: {
  device: UiDevice;
  selected: boolean;
  onSelect: () => void;
}) {
  const online = isOnline(device);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.currentTarget !== event.target) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`flex w-full cursor-pointer items-center gap-3 border-t border-slate-100 px-4 py-3 text-left transition ${
        selected ? 'bg-[#eef2ff]/80' : 'bg-white hover:bg-slate-50'
      }`}
    >
      <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
        {device.isLocal ? <Laptop className="h-5 w-5" /> : <Server className="h-5 w-5" />}
        <span
          className={`absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white ${
            online ? 'bg-emerald-500' : 'bg-slate-300'
          }`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-black text-slate-950">{device.name || '未命名设备'}</div>
        <CopyableIp value={device.virtualIp} className="mt-1 text-xs text-slate-500" />
      </div>
      <ChannelBadge device={device} />
    </div>
  );
}

function MobileDeviceDetails({
  device,
  open,
  onClose,
}: {
  device: UiDevice | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!open || !device) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/42 px-3 pb-3 pt-16 backdrop-blur-sm lg:hidden"
      onMouseDown={onClose}
    >
      <section
        className="absolute inset-x-3 bottom-3 max-h-[82vh] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-slate-950">{device.name || '未命名设备'}</div>
            <CopyableIp value={device.virtualIp} className="mt-0.5 text-xs text-slate-500" />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label="关闭详情"
            title="关闭详情"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <DeviceDetails device={device} className="max-h-[calc(82vh-64px)] overflow-y-auto bg-white p-4" />
      </section>
    </div>
  );
}

function DeviceDetails({
  device,
  className = 'min-h-[360px] overflow-y-auto bg-[#fbfbf8] p-4 sm:p-5 lg:min-h-0',
}: {
  device: UiDevice | null;
  className?: string;
}) {
  if (!device) {
    return (
      <div className={`grid place-items-center ${className}`}>
        <div className="text-center">
          <Server className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="text-sm font-bold text-slate-500">未选择设备。</p>
        </div>
      </div>
    );
  }

  const mismatch = !device.isLocal && device.clientSecret !== device.currentClientSecret;
  const shouldHidePeerNatInfo = hidesPeerNatInfo(device);
  const publicIps = shouldHidePeerNatInfo ? {ipv4: '', ipv6: ''} : splitIpVersions(device.publicIps, device.ipv6);
  const localIps = shouldHidePeerNatInfo ? {ipv4: '', ipv6: ''} : splitIpVersions(device.localIp);
  const missingPeerInfo = device.isLocal ? '--' : '对端未上报';
  const route = device.route;
  return (
    <div className={className}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${isOnline(device) ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <span className="text-xs font-black tracking-[0.16em] text-slate-400">
              {device.isLocal ? '本机设备' : '对端设备'}
            </span>
          </div>
          <h2 className="truncate text-2xl font-black text-slate-950">{device.name || '未命名设备'}</h2>
          <CopyableIp value={device.virtualIp} className="mt-1 text-sm text-slate-500" />
        </div>
        <ChannelBadge device={device} />
      </div>

      <div className="grid gap-3 min-[520px]:grid-cols-2">
        <Detail label="组网" value={device.groupName} />
        <Detail label="子网" value={device.subnet} />
        <Detail label="状态" value={displayStatus(device.status)} />
        <Detail label="延迟" value={device.isLocal ? '0 ms' : device.rt ? `${device.rt} ms` : '--'} />
        <Detail
          label="NAT 类型"
          value={shouldHidePeerNatInfo ? missingPeerInfo : displayOptionalValue(device.natType, missingPeerInfo)}
        />
        <Detail label="通道" value={channelPresentation(device).label} />
        {!device.isLocal && route && (
          <>
            <Detail label="下一跳" value={displayOptionalValue(route.nextHop)} />
            <Detail label="路由接口" value={displayRouteInterface(route.interface)} />
          </>
        )}
        <IpDetail label="公网 IP" ipv4={publicIps.ipv4} ipv6={publicIps.ipv6} emptyText={missingPeerInfo} wide />
        <IpDetail label="局域网 IP" ipv4={localIps.ipv4} ipv6={localIps.ipv6} emptyText={missingPeerInfo} wide />
      </div>

      {mismatch && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">
          <ShieldCheck className="h-4 w-4" />
          加密状态不一致。
        </div>
      )}
    </div>
  );
}

function Detail({label, value, wide}: {label: string; value: string; wide?: boolean}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 ${wide ? 'min-[520px]:col-span-2' : ''}`}>
      <div className="mb-1 text-[11px] font-black tracking-[0.14em] text-slate-400">{label}</div>
      <div className="break-words font-mono text-sm font-black text-slate-900">{value}</div>
    </div>
  );
}

function IpDetail({
  label,
  ipv4,
  ipv6,
  emptyText = '--',
  wide,
}: {
  label: string;
  ipv4: string;
  ipv6: string;
  emptyText?: string;
  wide?: boolean;
}) {
  const isEmpty = !ipv4 && !ipv6;

  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 ${wide ? 'min-[520px]:col-span-2' : ''}`}>
      <div className="mb-3 text-[11px] font-black tracking-[0.14em] text-slate-400">{label}</div>
      {isEmpty ? (
        <div className="font-mono text-sm font-black text-slate-500">{emptyText}</div>
      ) : (
        <div className="grid gap-3 min-[520px]:grid-cols-2">
          <div>
            <div className="mb-1 text-[10px] font-black tracking-[0.12em] text-slate-400">IPv4</div>
            <CopyableIp value={ipv4} className="text-sm text-slate-900" />
          </div>
          <div>
            <div className="mb-1 text-[10px] font-black tracking-[0.12em] text-slate-400">IPv6</div>
            <CopyableIp value={ipv6} className="text-sm text-slate-900" />
          </div>
        </div>
      )}
    </div>
  );
}

function CopyableIp({value, className = ''}: {value: string; className?: string}) {
  const display = displayOptionalValue(value);
  const canCopy = !isEmptyCoreValue(value);
  return (
    <span
      role="button"
      tabIndex={0}
      title={canCopy ? '点击复制 IP' : display}
      onClick={(event) => {
        event.stopPropagation();
        if (canCopy) void copyText(value);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        if (canCopy) void copyText(value);
      }}
      className={`inline-block max-w-full break-words font-mono font-black transition ${
        canCopy ? 'cursor-copy hover:text-vnt-primary' : 'cursor-default text-slate-400'
      } ${className}`}
    >
      {display}
    </span>
  );
}

function ChannelBadge({device}: {device: UiDevice}) {
  const channel = channelPresentation(device);
  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black ${channel.style}`}>
      {channel.label}
    </span>
  );
}

function EmptyState({text}: {text: string}) {
  return (
    <div className="grid h-full min-h-[220px] place-items-center p-8 text-center">
      <div>
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-slate-100 text-slate-400">
          <Server className="h-5 w-5" />
        </div>
        <p className="text-sm font-bold text-slate-500">{text}</p>
      </div>
    </div>
  );
}

function isOnline(device: UiDevice) {
  const status = (device.status || '').trim().toLowerCase();
  return status !== 'offline' && status !== 'stopped' && status !== 'error';
}

function channelPresentation(device: UiDevice) {
  if (device.isLocal) {
    return {label: '本地', style: 'border-emerald-200 bg-emerald-50 text-emerald-700'};
  }
  if (!isOnline(device)) {
    return {label: '离线', style: 'border-slate-200 bg-slate-100 text-slate-500'};
  }

  const normalized = normalizeChannel(device.natTraversalType);
  if (normalized.includes('p2p')) {
    return {label: '直连', style: 'border-emerald-200 bg-emerald-50 text-emerald-700'};
  }
  if (normalized.includes('relay')) {
    return {label: '中转', style: 'border-[#d9e1fb] bg-[#eef2ff] text-vnt-primary'};
  }
  if (normalized.includes('local')) {
    return {label: '本地', style: 'border-emerald-200 bg-emerald-50 text-emerald-700'};
  }

  return {label: normalized || '未知', style: 'border-slate-200 bg-slate-100 text-slate-600'};
}

function hidesPeerNatInfo(device: UiDevice) {
  if (device.isLocal) return false;
  const normalized = normalizeChannel(device.natTraversalType);
  return normalized.includes('relay');
}

function normalizeChannel(value: string) {
  return (value || '').trim().toLowerCase().replace(/^server[-_\s]*/, '');
}

function displayStatus(status: string) {
  const normalized = (status || '').trim().toLowerCase();
  if (normalized === 'online' || normalized === 'connected') return '在线';
  if (normalized === 'offline' || normalized === 'stopped') return '离线';
  if (normalized === 'error') return '异常';
  return status || '未知';
}

function sortDevices(devices: UiDevice[]) {
  return [...devices].sort((left, right) => {
    if (left.isLocal !== right.isLocal) return left.isLocal ? -1 : 1;
    const leftOnline = isOnline(left);
    const rightOnline = isOnline(right);
    if (leftOnline !== rightOnline) return leftOnline ? -1 : 1;
    return (left.name || left.virtualIp).localeCompare(right.name || right.virtualIp, 'zh-Hans-CN');
  });
}

function isRunningConnection(connection: {status: string}) {
  return connection.status === 'connecting' || connection.status === 'connected';
}

function findDeviceRoute(routes: CoreRoute[], virtualIp: string) {
  const ip = (virtualIp || '').trim();
  if (!ip) return null;
  return routes.find((route) => route.destination === ip || route.destination.startsWith(`${ip}/`)) || null;
}

function splitIpVersions(primary: string, ipv6Fallback = '') {
  const parts = `${primary || ''} ${ipv6Fallback || ''}`
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => !isEmptyCoreValue(part));
  const ipv4 = parts.filter((part) => !part.includes(':')).join(', ');
  const ipv6 = parts.filter((part) => part.includes(':')).join(', ');
  return {ipv4, ipv6};
}

function displayRouteInterface(value: string) {
  const normalized = normalizeChannel(value);
  if (normalized.includes('relay')) return '中转通道';
  if (normalized.includes('p2p')) return '直连通道';
  if (normalized.includes('tun')) return 'TUN';
  return displayOptionalValue(value);
}

function displayOptionalValue(value: string, fallback = '--') {
  return isEmptyCoreValue(value) ? fallback : value;
}

function isEmptyCoreValue(value: string) {
  const normalized = (value || '').trim().toLowerCase();
  return !normalized || normalized === '--' || normalized === 'none' || normalized === 'null';
}

function deviceKey(device: UiDevice | null) {
  if (!device) return '';
  return `${device.groupKey}-${device.virtualIp || device.name}-${device.isLocal ? 'local' : 'peer'}`;
}

function parseRegisterIp(logs: string[]) {
  for (const line of [...logs].reverse()) {
    const match = line.match(/register ip=([0-9.]+)/);
    if (match) return match[1];
  }
  return '';
}

function subnetLabel(ip: string) {
  const parts = ip.split('.');
  if (parts.length !== 4) return '自动分配子网';
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

function compactError(text: string) {
  const firstLine = text.split(/\r?\n/).find(Boolean) || text;
  return firstLine.length > 100 ? `${firstLine.slice(0, 100)}...` : firstLine;
}

function formatBytes(value: number) {
  if (!value) return '--';
  const units = ['B', 'KB', 'MB', 'GB'];
  let next = value;
  let unit = 0;
  while (next >= 1024 && unit < units.length - 1) {
    next /= 1024;
    unit += 1;
  }
  return `${next >= 10 ? next.toFixed(0) : next.toFixed(1)} ${units[unit]}`;
}

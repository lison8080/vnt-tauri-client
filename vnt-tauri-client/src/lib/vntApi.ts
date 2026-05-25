import {invoke} from '@tauri-apps/api/core';
import type {
  AppSnapshot,
  CommandPreview,
  CoreMode,
  CoreQuery,
  NetworkOverview,
  NetworkConfig,
  Preferences,
} from '../types';

const STORAGE_KEY = 'vnt-tauri-preview-state';

const isTauri = () =>
  typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

const randomId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const defaultConfig = (): NetworkConfig => ({
  itemKey: '',
  configName: '默认组网',
  token: '',
  deviceName:
    typeof navigator !== 'undefined'
      ? `VNT-${navigator.platform || 'Windows'}`
      : 'VNT-Windows',
  virtualIpv4: '',
  serverAddress: 'vnt.wherewego.top:29872',
  stunServers: [
    'stun.miwifi.com',
    'stun.chat.bilibili.com',
    'stun.hitv.com',
    'stun.cdnbye.com',
  ],
  inIps: [],
  outIps: [],
  portMappings: [],
  groupPassword: '',
  isServerEncrypted: true,
  protocol: 'UDP',
  dataFingerprintVerification: false,
  encryptionAlgorithm: 'aes_gcm',
  deviceId: randomId(),
  virtualNetworkCardName: '',
  mtu: 1410,
  ports: [],
  firstLatency: false,
  noInIpProxy: false,
  dns: [],
  simulatedPacketLossRate: 0,
  simulatedLatency: 0,
  punchModel: 'all',
  useChannelType: 'all',
  compressor: 'none',
  coreMode: 'tun',
  localDev: '',
  disableStats: false,
  allowWg: false,
  vntMappings: [],
  noTun: false,
  rtx: false,
  fec: false,
  noPunch: false,
  allowPortMapping: false,
  tunnelPort: null,
  certMode: 'skip',
});

const defaultSnapshot = (): AppSnapshot => ({
  configs: [],
  preferences: {
    autoConnectItemKey: '',
    autoStart: false,
    closeToTray: false,
  },
  connections: [],
  appLogs: [],
  coreAvailable: true,
  coreVersion: '预览模式',
});

const loadPreviewSnapshot = (): AppSnapshot => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSnapshot();
    return {...defaultSnapshot(), ...JSON.parse(raw)};
  } catch {
    return defaultSnapshot();
  }
};

const savePreviewSnapshot = (snapshot: AppSnapshot) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
};

export async function loadAppState(): Promise<AppSnapshot> {
  if (isTauri()) return invoke<AppSnapshot>('load_app_state');
  return loadPreviewSnapshot();
}

export async function saveConfig(config: NetworkConfig): Promise<AppSnapshot> {
  const normalizedConfig = normalizeTunConfig(config);
  if (isTauri()) return invoke<AppSnapshot>('save_config', {config: normalizedConfig});

  const snapshot = loadPreviewSnapshot();
  const nextConfig = {
    ...normalizedConfig,
    itemKey: normalizedConfig.itemKey || randomId(),
    configName: normalizedConfig.configName || normalizedConfig.token.slice(0, 6) || '未命名配置',
  };
  const index = snapshot.configs.findIndex((item) => item.itemKey === nextConfig.itemKey);
  if (index >= 0) snapshot.configs[index] = nextConfig;
  else snapshot.configs.push(nextConfig);
  savePreviewSnapshot(snapshot);
  return snapshot;
}

export async function deleteConfig(itemKey: string): Promise<AppSnapshot> {
  if (isTauri()) return invoke<AppSnapshot>('delete_config', {itemKey});

  const snapshot = loadPreviewSnapshot();
  snapshot.configs = snapshot.configs.filter((item) => item.itemKey !== itemKey);
  if (snapshot.preferences.autoConnectItemKey === itemKey) {
    snapshot.preferences.autoConnectItemKey = '';
  }
  savePreviewSnapshot(snapshot);
  return snapshot;
}

export async function connectConfig(itemKey: string): Promise<AppSnapshot> {
  if (isTauri()) return invoke<AppSnapshot>('connect_config', {itemKey});

  const snapshot = loadPreviewSnapshot();
  const config = snapshot.configs.find((item) => item.itemKey === itemKey);
  if (!config) throw new Error('未找到要连接的配置');
  if (!snapshot.connections.some((connection) => connection.itemKey === itemKey)) {
    snapshot.connections.push({
      itemKey,
      configName: config.configName,
      coreMode: 'tun',
      status: 'connected',
      pid: 0,
      startedAt: new Date().toISOString(),
      commandPreview: buildPreview(config).display,
      logs: ['[preview] 浏览器预览模式不会启动真实内核。'],
      lastError: null,
      exitCode: null,
    });
  }
  savePreviewSnapshot(snapshot);
  return snapshot;
}

export async function setTemporaryExit(
  itemKey: string,
  device?: {ip: string; name: string} | null,
): Promise<AppSnapshot> {
  if (isTauri()) {
    return invoke<AppSnapshot>('set_temporary_exit', {
      itemKey,
      deviceIp: device?.ip || null,
      deviceName: device?.name || null,
    });
  }

  const snapshot = loadPreviewSnapshot();
  const connection = snapshot.connections.find((item) => item.itemKey === itemKey);
  if (!connection) throw new Error('请先启动连接');
  const config = snapshot.configs.find((item) => item.itemKey === itemKey);
  connection.temporaryExitIp = device?.ip || undefined;
  connection.temporaryExitName = device?.name || undefined;
  connection.startedAt = new Date().toISOString();
  connection.logs = [
    ...(connection.logs || []),
    device
      ? `[preview] 临时出口已切换到 ${device.name || device.ip} (${device.ip})。`
      : '[preview] 临时出口已取消。',
  ];
  connection.commandPreview = [
    ...(config ? buildPreview(config).display : connection.commandPreview || []),
    ...(device ? ['-i', `0.0.0.0/0,${device.ip}`] : []),
  ];
  savePreviewSnapshot(snapshot);
  return snapshot;
}

export async function disconnectConfig(itemKey: string): Promise<AppSnapshot> {
  if (isTauri()) return invoke<AppSnapshot>('disconnect_config', {itemKey});

  const snapshot = loadPreviewSnapshot();
  snapshot.connections = snapshot.connections.filter((item) => item.itemKey !== itemKey);
  savePreviewSnapshot(snapshot);
  return snapshot;
}

export async function disconnectAll(): Promise<AppSnapshot> {
  if (isTauri()) return invoke<AppSnapshot>('disconnect_all');

  const snapshot = loadPreviewSnapshot();
  snapshot.connections = [];
  savePreviewSnapshot(snapshot);
  return snapshot;
}

export async function savePreferences(preferences: Preferences): Promise<AppSnapshot> {
  if (isTauri()) return invoke<AppSnapshot>('save_preferences', {preferences});

  const snapshot = loadPreviewSnapshot();
  snapshot.preferences = preferences;
  savePreviewSnapshot(snapshot);
  return snapshot;
}

export async function clearAppData(): Promise<AppSnapshot> {
  if (isTauri()) return invoke<AppSnapshot>('clear_app_data');
  localStorage.removeItem(STORAGE_KEY);
  return defaultSnapshot();
}

export async function getCommandPreview(config: NetworkConfig): Promise<CommandPreview> {
  if (isTauri()) return invoke<CommandPreview>('get_command_preview', {config});
  return buildPreview(config);
}

export async function exportConfig(itemKey: string): Promise<string> {
  if (isTauri()) return invoke<string>('export_config', {itemKey});
  const config = loadPreviewSnapshot().configs.find((item) => item.itemKey === itemKey);
  return JSON.stringify(config, null, 2);
}

export async function runCoreQuery(
  coreMode: CoreMode,
  query: CoreQuery,
  chartIp?: string,
): Promise<string> {
  if (isTauri()) {
    return invoke<string>('run_core_query', {
      coreMode,
      query,
      chartIp: chartIp || null,
    });
  }
  return `$ embedded-vnt-core --query ${query}\n\n浏览器预览模式不会查询真实内核。`;
}

export async function getNetworkOverview(coreMode: CoreMode, itemKey?: string): Promise<NetworkOverview> {
  if (isTauri()) {
    return normalizeNetworkOverview(
      await invoke('get_network_overview', {
        coreMode,
        itemKey: itemKey || null,
      }),
    );
  }

  const config = itemKey ? loadPreviewSnapshot().configs.find((item) => item.itemKey === itemKey) : null;
  const baseIp = config?.virtualIpv4 || '10.26.0.4';
  const subnetPrefix = baseIp.split('.').slice(0, 3).join('.') || '10.26.0';
  return {
    info: {
      name: config?.deviceName || 'VNT-Win32',
      virtualIp: baseIp,
      virtualGateway: `${subnetPrefix}.1`,
      virtualNetmask: '255.255.255.0',
      connectStatus: 'Connected',
      relayServer: config?.serverAddress || '8.138.190.189:29872',
      natType: 'Cone',
      publicIps: '8.8.8.8',
      localAddr: '192.168.1.20',
      ipv6Addr: '',
    },
    devices: [
      {
        name: '家用 NAS',
        virtualIp: `${subnetPrefix}.2`,
        natType: 'Cone',
        publicIps: '1.2.3.4',
        localIp: '192.168.1.10',
        ipv6: '',
        natTraversalType: 'p2p',
        rt: '14',
        status: 'Online',
        clientSecret: true,
        currentClientSecret: true,
        wireGuard: false,
      },
      {
        name: '云服务器',
        virtualIp: `${subnetPrefix}.3`,
        natType: 'Symmetric',
        publicIps: '5.6.7.8',
        localIp: '10.0.0.2',
        ipv6: '',
        natTraversalType: 'relay',
        rt: '46',
        status: 'Online',
        clientSecret: true,
        currentClientSecret: true,
        wireGuard: false,
      },
    ],
    routes: [],
    stats: {
      disableStats: false,
      upTotal: 1258291,
      downTotal: 5033164,
      upMap: {},
      downMap: {},
    },
    error: null,
  };
}

export async function setAndroidSystemBars(theme: 'light' | 'dark', modalOpen: boolean) {
  if (!isTauri()) return;
  try {
    await invoke('set_android_system_bars', {theme, modalOpen});
  } catch {
    await invoke('set_android_system_bars', {theme, modal_open: modalOpen});
  }
}

function normalizeNetworkOverview(raw: any): NetworkOverview {
  const info = raw?.info
    ? {
        name: value(raw.info, 'name'),
        virtualIp: value(raw.info, 'virtualIp', 'virtual_ip'),
        virtualGateway: value(raw.info, 'virtualGateway', 'virtual_gateway'),
        virtualNetmask: value(raw.info, 'virtualNetmask', 'virtual_netmask'),
        connectStatus: value(raw.info, 'connectStatus', 'connect_status'),
        relayServer: value(raw.info, 'relayServer', 'relay_server'),
        natType: value(raw.info, 'natType', 'nat_type'),
        publicIps: value(raw.info, 'publicIps', 'public_ips'),
        localAddr: value(raw.info, 'localAddr', 'local_addr'),
        ipv6Addr: value(raw.info, 'ipv6Addr', 'ipv6_addr'),
      }
    : null;

  return {
    info,
    devices: Array.isArray(raw?.devices)
      ? raw.devices.map((device: any) => ({
          name: value(device, 'name'),
          virtualIp: value(device, 'virtualIp', 'virtual_ip'),
          natType: value(device, 'natType', 'nat_type'),
          publicIps: value(device, 'publicIps', 'public_ips'),
          localIp: value(device, 'localIp', 'local_ip'),
          ipv6: value(device, 'ipv6'),
          natTraversalType: value(device, 'natTraversalType', 'nat_traversal_type'),
          rt: value(device, 'rt'),
          status: value(device, 'status'),
          clientSecret: Boolean(rawBool(device, 'clientSecret', 'client_secret')),
          currentClientSecret: Boolean(rawBool(device, 'currentClientSecret', 'current_client_secret')),
          wireGuard: Boolean(rawBool(device, 'wireGuard', 'wire_guard')),
        }))
      : [],
    routes: Array.isArray(raw?.routes)
      ? raw.routes.map((route: any) => ({
          destination: value(route, 'destination'),
          nextHop: value(route, 'nextHop', 'next_hop'),
          metric: value(route, 'metric'),
          rt: value(route, 'rt'),
          interface: value(route, 'interface'),
        }))
      : [],
    stats: raw?.stats
      ? {
          disableStats: Boolean(rawBool(raw.stats, 'disableStats', 'disable_stats')),
          upTotal: numberValue(raw.stats, 'upTotal', 'up_total'),
          downTotal: numberValue(raw.stats, 'downTotal', 'down_total'),
          upMap: raw.stats.upMap || raw.stats.up_map || {},
          downMap: raw.stats.downMap || raw.stats.down_map || {},
        }
      : null,
    error: raw?.error || null,
  };
}

function value(source: any, camelKey: string, snakeKey?: string) {
  return `${source?.[camelKey] ?? (snakeKey ? source?.[snakeKey] : undefined) ?? ''}`;
}

function rawBool(source: any, camelKey: string, snakeKey?: string) {
  return source?.[camelKey] ?? (snakeKey ? source?.[snakeKey] : undefined) ?? false;
}

function numberValue(source: any, camelKey: string, snakeKey?: string) {
  const raw = source?.[camelKey] ?? (snakeKey ? source?.[snakeKey] : undefined) ?? 0;
  return Number(raw) || 0;
}

function buildPreview(config: NetworkConfig): CommandPreview {
  const executable = 'embedded-vnt-core';
  const args = [
    '--network-code',
    '******',
    '--device-name',
    config.deviceName.trim(),
    '--server',
    config.serverAddress.trim(),
    ...(config.groupPassword.trim() ? ['--password', '******'] : []),
    ...(config.virtualIpv4.trim() ? ['--ip', config.virtualIpv4.trim()] : []),
    ...(config.noTun ? ['--no-tun'] : []),
    ...(config.rtx ? ['--rtx'] : []),
    ...(config.fec ? ['--fec'] : []),
    ...(config.noPunch ? ['--no-punch'] : []),
    ...(config.allowPortMapping ? ['--allow-port-mapping'] : []),
    ...(config.tunnelPort ? ['--tunnel-port', `${config.tunnelPort}`] : []),
    ...(config.certMode ? ['--cert-mode', config.certMode] : []),
    ...(config.compressor && config.compressor !== 'none' ? ['--compress'] : []),
  ];
  const display = [executable, ...args];
  return {executable, args, display};
}

function normalizeTunConfig(config: NetworkConfig): NetworkConfig {
  const protocol = (config.protocol as string) === 'WS' ? 'WSS' : config.protocol;
  return {
    ...config,
    coreMode: 'tun',
    protocol,
  };
}

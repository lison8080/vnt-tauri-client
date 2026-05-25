export type TabType = 'home' | 'network' | 'settings';
export type CoreMode = 'tun';
export type ConnectionStatus = 'connecting' | 'connected' | 'stopped' | 'error';
export type ThemeMode = 'light' | 'dark';
export type ThemePreference = 'system' | ThemeMode;

export interface NetworkConfig {
  itemKey: string;
  configName: string;
  token: string;
  deviceName: string;
  virtualIpv4: string;
  serverAddress: string;
  stunServers: string[];
  inIps: string[];
  outIps: string[];
  portMappings: string[];
  groupPassword: string;
  isServerEncrypted: boolean;
  protocol: 'UDP' | 'TCP' | 'WSS';
  dataFingerprintVerification: boolean;
  encryptionAlgorithm:
    | 'aes_gcm'
    | 'chacha20_poly1305'
    | 'chacha20'
    | 'aes_cbc'
    | 'aes_ecb'
    | 'sm4_cbc'
    | 'xor';
  deviceId: string;
  virtualNetworkCardName: string;
  mtu: number;
  ports: number[];
  firstLatency: boolean;
  noInIpProxy: boolean;
  dns: string[];
  simulatedPacketLossRate: number;
  simulatedLatency: number;
  punchModel:
    | 'ipv4'
    | 'ipv6'
    | 'ipv4-tcp'
    | 'ipv4-udp'
    | 'ipv6-tcp'
    | 'ipv6-udp'
    | 'all';
  useChannelType: 'relay' | 'p2p' | 'all';
  compressor: string;
  coreMode: CoreMode;
  localDev: string;
  disableStats: boolean;
  allowWg: boolean;
  vntMappings: string[];
  noTun: boolean;
  rtx: boolean;
  fec: boolean;
  noPunch: boolean;
  allowPortMapping: boolean;
  tunnelPort: number | null;
  certMode: 'skip' | 'system' | 'pinned' | string;
}

export interface Preferences {
  autoConnectItemKey: string;
  autoStart: boolean;
  closeToTray: boolean;
}

export interface ConnectionView {
  itemKey: string;
  configName: string;
  coreMode: CoreMode;
  status: ConnectionStatus;
  temporaryExitIp?: string;
  temporaryExitName?: string;
  pid?: number;
  startedAt: string;
  commandPreview: string[];
  logs: string[];
  lastError?: string | null;
  exitCode?: number | null;
}

export interface AppSnapshot {
  configs: NetworkConfig[];
  preferences: Preferences;
  connections: ConnectionView[];
  appLogs: string[];
  coreAvailable: boolean;
  coreVersion: string;
}

export interface CommandPreview {
  executable: string;
  args: string[];
  display: string[];
}

export interface NetworkOverview {
  info?: CoreInfo | null;
  devices: CoreDevice[];
  routes: CoreRoute[];
  stats?: CoreChart | null;
  error?: string | null;
}

export interface CoreInfo {
  name: string;
  virtualIp: string;
  virtualGateway: string;
  virtualNetmask: string;
  connectStatus: string;
  relayServer: string;
  natType: string;
  publicIps: string;
  localAddr: string;
  ipv6Addr: string;
}

export interface CoreDevice {
  name: string;
  virtualIp: string;
  natType: string;
  publicIps: string;
  localIp: string;
  ipv6: string;
  natTraversalType: string;
  rt: string;
  status: string;
  clientSecret: boolean;
  currentClientSecret: boolean;
  wireGuard: boolean;
}

export interface CoreRoute {
  destination: string;
  nextHop: string;
  metric: string;
  rt: string;
  interface: string;
}

export interface CoreChart {
  disableStats: boolean;
  upTotal: number;
  downTotal: number;
  upMap: Record<string, number>;
  downMap: Record<string, number>;
}

export type CoreQuery = 'info' | 'list' | 'all' | 'route' | 'chart_a' | 'chart_b' | 'help';

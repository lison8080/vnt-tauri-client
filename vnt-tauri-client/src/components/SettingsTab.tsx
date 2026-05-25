import {useEffect, useState, type ReactNode} from 'react';
import {AnimatePresence, LayoutGroup, motion} from 'motion/react';
import {
  Cpu,
  Eye,
  EyeOff,
  FilePlus2,
  Lock,
  MonitorCog,
  Network,
  Save,
  Server,
  Shield,
  Sun,
  Moon,
  SunMoon,
  TimerReset,
  X,
  Wifi,
} from 'lucide-react';
import type {AppSnapshot, NetworkConfig, Preferences, ThemeMode, ThemePreference} from '../types';

interface SettingsTabProps {
  snapshot: AppSnapshot;
  draft: NetworkConfig;
  setDraft: (config: NetworkConfig) => void;
  selectedKey: string;
  onSelectConfig: (itemKey: string) => void;
  onCreateConfig: () => void;
  onSave: () => Promise<void>;
  onDelete: (itemKey: string) => Promise<void>;
  onSavePreferences: (preferences: Preferences) => Promise<void>;
  themePreference: ThemePreference;
  effectiveThemeMode: ThemeMode;
  onChangeThemePreference: (preference: ThemePreference) => void;
}

const protocols = ['UDP', 'TCP', 'WSS'] as const;
const certModes = [
  ['skip', '跳过证书校验'],
  ['standard', '系统证书校验'],
] as const;
type SettingsMode = 'config' | 'other';

export function SettingsTab({
  snapshot,
  draft,
  setDraft,
  selectedKey,
  onSelectConfig,
  onCreateConfig,
  onSave,
  onDelete,
  onSavePreferences,
  themePreference,
  effectiveThemeMode,
  onChangeThemePreference,
}: SettingsTabProps) {
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [settingsMode, setSettingsMode] = useState<SettingsMode>('config');
  const [preferencesDraft, setPreferencesDraft] = useState(snapshot.preferences);
  const mobileRuntime = isMobileRuntime();

  useEffect(() => {
    setPreferencesDraft(snapshot.preferences);
  }, [snapshot.preferences]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const update = <K extends keyof NetworkConfig>(key: K, value: NetworkConfig[K]) => {
    setDraft({...draft, [key]: value});
  };

  const runAction = async (action: () => Promise<void>, message: string) => {
    setBusy(true);
    setNotice('');
    try {
      await action();
      setNotice(message);
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  };

  const saveStartupPreferences = async (preferences: Preferences) => {
    const normalized = mobileRuntime
      ? {...preferences, autoStart: false, closeToTray: false}
      : preferences;
    setPreferencesDraft(normalized);
    await runAction(async () => {
      await onSavePreferences(normalized);
    }, '其他设置已更新');
  };

  const deleteConfig = async (itemKey: string) => {
    await runAction(async () => {
      await onDelete(itemKey);
    }, '配置已删除');
  };

  const compressorMode = draft.compressor.startsWith('zstd')
    ? 'zstd'
    : draft.compressor === 'lz4'
      ? 'lz4'
      : 'none';
  const compressionLevel = draft.compressor.startsWith('zstd')
    ? draft.compressor.split(',')[1] || '3'
    : '3';

  return (
    <div className="vnt-app-scroll h-full min-w-0 overflow-y-auto px-4 pb-44 pt-4 sm:px-5 sm:pb-44 sm:pt-5 lg:p-6">
      <AnimatePresence>
        {notice && (
          <motion.div
            key={notice}
            className="pointer-events-none fixed left-4 right-4 top-[70px] z-50 flex justify-center lg:left-[248px] lg:top-[58px]"
            initial={{opacity: 0, y: -10, scale: 0.98}}
            animate={{opacity: 1, y: 0, scale: 1}}
            exit={{opacity: 0, y: -8, scale: 0.98}}
            transition={{duration: 0.22, ease: [0.22, 1, 0.36, 1]}}
          >
            <div className="max-w-[min(420px,100%)] rounded-xl border border-[#d9e1fb] bg-[#eef2ff]/95 px-4 py-3 text-sm font-black text-vnt-primary shadow-lg backdrop-blur-md">
              {notice}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <header className="mb-5 flex min-w-0">
        <ModeTabs mode={settingsMode} onChange={setSettingsMode} />
      </header>

      <SettingsModePanel mode={settingsMode}>
        {settingsMode === 'config' ? (
          <div className="grid min-w-0 gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="min-w-0">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
                  <h2 className="font-black text-slate-950">配置列表</h2>
                </div>
                <div className="mb-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={onCreateConfig}
                    className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50"
                  >
                    <FilePlus2 className="h-4 w-4" />
                    新建
                  </button>
                  <button
                    type="button"
                    onClick={() => void runAction(onSave, '配置已保存')}
                    disabled={busy}
                    className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl bg-vnt-primary px-3 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-[#4265b8] disabled:opacity-60"
                  >
                    <Save className="h-4 w-4" />
                    保存
                  </button>
                </div>
                <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1 xl:max-h-none xl:overflow-visible xl:pr-0">
                  {snapshot.configs.length === 0 ? (
                    <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-400">
                      还没有保存的组网配置。
                    </p>
                  ) : (
                    snapshot.configs.map((config) => (
                      <div
                        key={config.itemKey}
                        className={`grid w-full grid-cols-[minmax(0,1fr)_32px] items-center gap-2 rounded-2xl border px-3 py-2.5 transition ${
                          selectedKey === config.itemKey
                            ? 'border-[#d9e1fb] bg-[#eef2ff]'
                            : 'border-slate-100 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectConfig(config.itemKey)}
                          className="min-w-0 text-left"
                        >
                          <div className="truncate text-sm font-black text-slate-900">
                            {config.configName}
                          </div>
                          <div className="mt-1 truncate font-mono text-xs text-slate-400">
                            {config.serverAddress}
                          </div>
                        </button>
                        <button
                          type="button"
                          aria-label={`删除 ${config.configName}`}
                          title="删除"
                          disabled={busy}
                          onClick={() => void deleteConfig(config.itemKey)}
                          className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          <X className="h-4 w-4" strokeWidth={2.6} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </aside>
            <main className="min-w-0 space-y-5">
              <ConfigSettings
                draft={draft}
                update={update}
                compressorMode={compressorMode}
                compressionLevel={compressionLevel}
              />
            </main>
          </div>
        ) : (
          <main className="min-w-0 space-y-5">
            <StartupSettings
              configs={snapshot.configs}
              preferencesDraft={preferencesDraft}
              onChangePreferences={saveStartupPreferences}
              mobileRuntime={mobileRuntime}
            />
            <ThemeSettings
              preference={themePreference}
              effectiveMode={effectiveThemeMode}
              onChangePreference={onChangeThemePreference}
            />
          </main>
        )}
      </SettingsModePanel>
    </div>
  );
}

type ConfigUpdate = <K extends keyof NetworkConfig>(key: K, value: NetworkConfig[K]) => void;

function ModeTabs({
  mode,
  onChange,
}: {
  mode: SettingsMode;
  onChange: (mode: SettingsMode) => void;
}) {
  const tabs: Array<{id: SettingsMode; label: string}> = [
    {id: 'config', label: '配置设置'},
    {id: 'other', label: '其他设置'},
  ];
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === mode));

  return (
    <LayoutGroup id="settings-mode-tabs">
      <div className="relative inline-flex w-full overflow-hidden rounded-xl bg-black/[0.035] p-1 min-[520px]:w-auto">
        <motion.span
          className="absolute bottom-1 left-1 top-1 rounded-lg bg-white shadow-sm"
          style={{width: 'calc((100% - 8px) / 2)'}}
          animate={{x: `${activeIndex * 100}%`}}
          transition={settingsPillTransition}
        />
        {tabs.map((tab) => {
          const active = mode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`relative z-10 flex-1 rounded-lg px-4 py-2.5 text-sm font-black leading-5 transition min-[520px]:flex-none lg:text-[14px] ${
                active ? 'text-slate-950' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

function SettingsModePanel({
  mode,
  children,
}: {
  mode: SettingsMode;
  children: ReactNode;
}) {
  const direction = mode === 'other' ? 1 : -1;
  const desktopLayout = useDesktopLayout();
  return (
    <div className="relative min-w-0 overflow-hidden">
      <AnimatePresence custom={direction} initial={false} mode="popLayout">
        <motion.div
          key={mode}
          custom={direction}
          variants={desktopLayout ? settingsPanelFadeVariants : settingsPanelVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={desktopLayout ? settingsPanelFadeTransition : settingsPanelTransition}
          className="vnt-settings-panel min-w-0"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function StartupSettings({
  configs,
  preferencesDraft,
  onChangePreferences,
  mobileRuntime,
}: {
  configs: NetworkConfig[];
  preferencesDraft: Preferences;
  onChangePreferences: (preferences: Preferences) => void;
  mobileRuntime: boolean;
}) {
  return (
    <FormSection
      icon={TimerReset}
      title="启动设置"
      subtitle="应用启动"
    >
      <div className="grid gap-4">
        <label className="block min-w-0">
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.18em] text-slate-400">
            自动连接配置
          </span>
          <select
            value={preferencesDraft.autoConnectItemKey}
            onChange={(event) =>
              onChangePreferences({
                ...preferencesDraft,
                autoConnectItemKey: event.target.value,
              })
            }
            className="w-full min-w-0 rounded-xl border border-slate-200 bg-[#fbfbf8] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#9db0e0] focus:bg-white"
          >
            <option value="">不自动连接</option>
            {configs.map((config) => (
              <option key={config.itemKey} value={config.itemKey}>
                {config.configName}
              </option>
            ))}
          </select>
        </label>
        {!mobileRuntime && (
          <div className="grid gap-3 min-[760px]:grid-cols-2">
            <Toggle
              label="开机自启"
              param="应用内"
              description="登录 Windows 后自动启动 VNT Mesh"
              checked={preferencesDraft.autoStart}
              onChange={(value) =>
                onChangePreferences({
                  ...preferencesDraft,
                  autoStart: value,
                })
              }
            />
            <Toggle
              label="关闭到托盘"
              param="应用内"
              description="点击关闭按钮时隐藏到系统托盘"
              checked={preferencesDraft.closeToTray}
              onChange={(value) =>
                onChangePreferences({
                  ...preferencesDraft,
                  closeToTray: value,
                })
              }
            />
          </div>
        )}
      </div>
    </FormSection>
  );
}

function ThemeSettings({
  preference,
  effectiveMode,
  onChangePreference,
}: {
  preference: ThemePreference;
  effectiveMode: ThemeMode;
  onChangePreference: (preference: ThemePreference) => void;
}) {
  const modes: Array<{
    value: ThemePreference;
    label: string;
    description: string;
    icon: typeof Sun;
  }> = [
    {
      value: 'system',
      label: '自动',
      description: `跟随系统，当前${effectiveMode === 'dark' ? '暗色' : '亮色'}`,
      icon: SunMoon,
    },
    {value: 'light', label: '亮色', description: '始终使用浅色界面', icon: Sun},
    {value: 'dark', label: '暗色', description: '始终使用深色界面', icon: Moon},
  ];

  return (
    <FormSection icon={MonitorCog} title="主题设置" subtitle="界面亮暗模式">
      <div className="grid gap-3 min-[760px]:grid-cols-3">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const active = preference === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => onChangePreference(mode.value)}
              className={`flex min-w-0 items-center gap-3 rounded-xl border p-4 text-left transition ${
                active
                  ? 'border-[#d9e1fb] bg-[#eef2ff] text-vnt-primary'
                  : 'border-slate-200 bg-[#fbfbf8] text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span
                className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                  active ? 'bg-white' : 'bg-white text-slate-500'
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={2.35} />
                {mode.value === 'system' && (
                  <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-vnt-primary px-1 text-[9px] font-black leading-none text-white">
                    A
                  </span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-black">{mode.label}</span>
                <span className="mt-1 block truncate text-xs font-bold text-slate-400">
                  {mode.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </FormSection>
  );
}

function ConfigSettings({
  draft,
  update,
  compressorMode,
  compressionLevel,
}: {
  draft: NetworkConfig;
  update: ConfigUpdate;
  compressorMode: string;
  compressionLevel: string;
}) {
  return (
    <>
      <BasicSettings draft={draft} update={update} />
      <AdvancedSettings
        draft={draft}
        update={update}
        compressorMode={compressorMode}
        compressionLevel={compressionLevel}
      />
    </>
  );
}

function isMobileRuntime() {
  const platform = typeof window !== 'undefined'
    ? (window as any).__TAURI_INTERNALS__?.metadata?.platform
    : '';
  if (typeof platform === 'string' && ['android', 'ios'].includes(platform.toLowerCase())) {
    return true;
  }
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function BasicSettings({draft, update}: {draft: NetworkConfig; update: ConfigUpdate}) {
  return (
    <FormSection icon={Server} title="基础设置">
      <div className="grid gap-4 min-[760px]:grid-cols-2">
        <TextField
          label="配置名称"
          param="应用内"
          value={draft.configName}
          onChange={(value) => update('configName', value)}
          maxLength={10}
          placeholder="例如 家里 / 公司"
        />
        <TextField
          label="组网编号"
          param="-k"
          value={draft.token}
          onChange={(value) => update('token', value)}
          maxLength={64}
          placeholder="同一组设备填相同编号"
        />
        <SelectField
          label="通信方式"
          param="-s"
          value={draft.protocol}
          options={protocols.map((value) => [value, value])}
          onChange={(value) => update('protocol', value as NetworkConfig['protocol'])}
        />
        <TextField
          label="服务器地址"
          param="-s"
          value={draft.serverAddress}
          onChange={(value) => update('serverAddress', value)}
          maxLength={64}
          placeholder="vnt.wherewego.top:29872"
        />
        <TextField
          label="设备名称"
          param="-n"
          value={draft.deviceName}
          onChange={(value) => update('deviceName', value)}
          maxLength={64}
          placeholder="例如 我的电脑"
        />
        <TextField
          label="虚拟 IP"
          param="--ip"
          value={draft.virtualIpv4}
          onChange={(value) => update('virtualIpv4', value)}
          maxLength={15}
          placeholder="留空自动分配"
        />
        <TextField
          label="设备编号"
          param="-d"
          value={draft.deviceId}
          onChange={(value) => update('deviceId', value)}
          placeholder="用于服务端分配虚拟 IP"
          inputClassName="font-mono text-[13px]"
          wide
        />
      </div>
    </FormSection>
  );
}

function AdvancedSettings({
  draft,
  update,
  compressorMode,
  compressionLevel,
}: {
  draft: NetworkConfig;
  update: ConfigUpdate;
  compressorMode: string;
  compressionLevel: string;
}) {
  return (
    <>
      <FormSection icon={Wifi} title="NAT 与中转">
        <div className="grid gap-4 min-[760px]:grid-cols-2">
          <ListField
            label="STUN 服务器"
            param="-e"
            value={draft.stunServers}
            onChange={(value) => update('stunServers', value)}
            placeholder="stun.miwifi.com"
          />
          <ListField
            label="DNS"
            param="--dns"
            value={draft.dns}
            onChange={(value) => update('dns', value)}
            placeholder="223.5.5.5:53"
          />
          <ListField
            label="in-ip"
            param="-i"
            value={draft.inIps}
            onChange={(value) => update('inIps', value)}
            placeholder="192.168.0.1/24,10.26.0.10"
          />
          <ListField
            label="out-ip"
            param="-o"
            value={draft.outIps}
            onChange={(value) => update('outIps', value)}
            placeholder="0.0.0.0/0"
          />
          <ListField
            label="端口映射"
            param="--mapping"
            value={draft.portMappings}
            onChange={(value) => update('portMappings', value)}
            placeholder="tcp://0.0.0.0:80-10.26.0.10-192.168.1.10:80"
          />
        </div>
      </FormSection>

      <FormSection icon={Lock} title="传输安全">
        <div className="grid gap-4 min-[760px]:grid-cols-2">
          <TextField
            label="组网密码"
            param="-w"
            value={draft.groupPassword}
            onChange={(value) => update('groupPassword', value)}
            type="password"
            revealable
            maxLength={256}
            placeholder="可选，建议同组设备一致"
          />
          <SelectField
            label="证书校验"
            param="--cert-mode"
            value={draft.certMode || 'skip'}
            options={certModes}
            onChange={(value) => update('certMode', value)}
          />
        </div>
      </FormSection>

      <FormSection icon={Network} title="通道与性能">
        <div className="grid gap-4 min-[700px]:grid-cols-2 min-[1100px]:grid-cols-3">
          <SelectField
            label="压缩"
            param="--compressor"
            value={compressorMode}
            options={[
              ['none', '不压缩'],
              ['lz4', 'lz4'],
              ['zstd', 'zstd'],
            ]}
            onChange={(value) =>
              update('compressor', value === 'zstd' ? `zstd,${compressionLevel}` : value)
            }
          />
          {compressorMode === 'zstd' && (
            <SelectField
              label="zstd 压缩级别"
              param="--compressor"
              value={compressionLevel}
              options={Array.from({length: 23}, (_, index) => [
                `${index}`,
                `${index}`,
              ])}
              onChange={(value) => update('compressor', `zstd,${value}`)}
            />
          )}
        </div>
        <div className="mt-4 grid gap-4 min-[760px]:grid-cols-2">
          <Toggle
            label="关闭内置 IP 中转"
            param="--no-proxy"
            description="需要自行配置网卡 NAT 转发"
            checked={draft.noInIpProxy}
            onChange={(value) => update('noInIpProxy', value)}
          />
          <Toggle
            label="禁用打洞"
            param="--no-punch"
            description="只使用服务端中转，不尝试 P2P 打洞"
            checked={draft.noPunch}
            onChange={(value) => update('noPunch', value)}
          />
          <Toggle
            label="启用重传"
            param="--rtx"
            description="开启 VNT2 可靠传输增强"
            checked={draft.rtx}
            onChange={(value) => update('rtx', value)}
          />
          <Toggle
            label="启用 FEC"
            param="--fec"
            description="开启前向纠错以改善弱网体验"
            checked={draft.fec}
            onChange={(value) => update('fec', value)}
          />
        </div>
      </FormSection>

      <FormSection icon={Cpu} title="网卡与内核扩展">
        <div className="grid gap-4 min-[760px]:grid-cols-2">
          <div className="min-[760px]:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
            Android/iOS 的系统 VPN/TUN 桥接尚未接线；移动端请先开启无 TUN 模式，
            否则启动会在原生网卡阶段失败。
          </div>
          <TextField
            label="虚拟网卡名称"
            param="--nic"
            value={draft.virtualNetworkCardName}
            onChange={(value) => update('virtualNetworkCardName', value)}
            maxLength={10}
            placeholder="tun0"
          />
          <TextField
            label="MTU"
            param="-u"
            value={`${draft.mtu}`}
            onChange={(value) => update('mtu', Number(value) || 0)}
            type="number"
          />
          <TextField
            label="隧道端口"
            param="--tunnel-port"
            value={draft.tunnelPort ? `${draft.tunnelPort}` : ''}
            onChange={(value) => update('tunnelPort', value ? Number(value) || null : null)}
            type="number"
            placeholder="留空自动选择"
          />
        </div>
        <div className="mt-4 grid gap-4 min-[760px]:grid-cols-2">
          <Toggle
            label="无 TUN 模式"
            param="--no-tun"
            description="只建立 VNT 网络，不创建系统虚拟网卡"
            checked={draft.noTun}
            onChange={(value) => update('noTun', value)}
          />
          <Toggle
            label="允许端口映射"
            param="--allow-port-mapping"
            description="接受 VNT2 端口映射规则"
            checked={draft.allowPortMapping}
            onChange={(value) => update('allowPortMapping', value)}
          />
        </div>
      </FormSection>
    </>
  );
}

function FormSection({
  icon: Icon,
  title,
  subtitle = '',
  children,
}: {
  icon: typeof Shield;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-600">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="font-black text-slate-950">{title}</h2>
          {subtitle && <p className="text-xs font-bold text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function TextField({
  label,
  param,
  value,
  onChange,
  placeholder,
  type = 'text',
  maxLength,
  revealable = false,
  inputClassName = '',
  wide = false,
}: {
  label: string;
  param?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  maxLength?: number;
  revealable?: boolean;
  inputClassName?: string;
  wide?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const inputType = revealable && type === 'password' && visible ? 'text' : type;

  return (
    <label className={`block min-w-0 ${wide ? 'min-[760px]:col-span-2' : ''}`}>
      <FieldLabel label={label} param={param} />
      <span className="relative block">
        <input
          type={inputType}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={`w-full min-w-0 rounded-xl border border-slate-200 bg-[#fbfbf8] px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#9db0e0] focus:bg-white ${inputClassName} ${
            revealable ? 'pr-11' : ''
          }`}
        />
        {revealable && (
          <button
            type="button"
            onClick={() => setVisible((current) => !current)}
            className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label={visible ? '隐藏密码' : '显示密码'}
            title={visible ? '隐藏密码' : '显示密码'}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </span>
    </label>
  );
}

function SelectField({
  label,
  param,
  value,
  options,
  onChange,
}: {
  label: string;
  param?: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0">
      <FieldLabel label={label} param={param} />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full min-w-0 rounded-xl border border-slate-200 bg-[#fbfbf8] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#9db0e0] focus:bg-white"
      >
        {options.map(([optionValue, labelText]) => (
          <option key={optionValue} value={optionValue}>
            {labelText}
          </option>
        ))}
      </select>
    </label>
  );
}

function ListField({
  label,
  param,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  param?: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  return (
    <label className="block min-w-0">
      <FieldLabel label={label} param={param} />
      <textarea
        value={value.join('\n')}
        onChange={(event) => onChange(linesToList(event.target.value))}
        placeholder={placeholder}
        rows={4}
        className="w-full min-w-0 resize-y rounded-xl border border-slate-200 bg-[#fbfbf8] px-4 py-3 font-mono text-xs text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#9db0e0] focus:bg-white"
      />
      <span className="mt-1 block text-[11px] font-bold text-slate-400">每行一个值</span>
    </label>
  );
}

function Toggle({
  label,
  param,
  description,
  checked,
  onChange,
}: {
  label: string;
  param?: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="mb-3 flex w-full items-center justify-between gap-4 rounded-xl border border-slate-200 bg-[#fbfbf8] p-4 text-left transition hover:bg-slate-50"
    >
      <span>
        <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-black text-slate-900">
          <span>{label}</span>
          {param && <CommandBadge value={param} />}
        </span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
      <span
        className={`flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition ${
          checked ? 'bg-vnt-primary' : 'bg-slate-300'
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}

function FieldLabel({label, param}: {label: string; param?: string}) {
  return (
    <span className="mb-2 flex min-w-0 items-center gap-2">
      <span className="truncate text-xs font-black uppercase tracking-[0.18em] text-slate-400">
        {label}
      </span>
      {param && <CommandBadge value={param} />}
    </span>
  );
}

function CommandBadge({value}: {value: string}) {
  const isInternal = value === '应用内';
  return (
    <span
      className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-black leading-none ${
        isInternal
          ? 'bg-slate-100 text-slate-400'
          : 'bg-[#eef2ff] text-vnt-primary'
      }`}
    >
      {value}
    </span>
  );
}

function linesToList(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const settingsPillTransition = {
  type: 'spring',
  stiffness: 430,
  damping: 34,
  mass: 0.78,
} as const;

const settingsPanelVariants = {
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

const settingsPanelFadeVariants = {
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

const settingsPanelTransition = {
  x: {type: 'spring', stiffness: 320, damping: 36, mass: 0.92},
} as const;

const settingsPanelFadeTransition = {
  opacity: {duration: 0.16, ease: 'easeOut'},
} as const;

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

import {motion} from 'motion/react';
import {Home, Network, Settings} from 'lucide-react';
import type { TabType } from '../types';

interface BottomNavProps {
  currentTab: TabType;
  onChangeTab: (tab: TabType) => void;
}

export function BottomNav({ currentTab, onChangeTab }: BottomNavProps) {
  const tabs = [
    { id: 'home', label: '总览', icon: Home },
    { id: 'network', label: '设备', icon: Network },
    { id: 'settings', label: '设置', icon: Settings },
  ] as const;
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === currentTab));

  return (
    <div className="pointer-events-none relative flex shrink-0 justify-center bg-transparent px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-8">
      <nav className="vnt-frosted-nav relative flex h-[78px] w-full max-w-[420px] items-center justify-between overflow-hidden rounded-[26px] px-2 py-2">
        <motion.span
          className="vnt-frosted-nav-item-active absolute bottom-2 left-2 top-2 rounded-[20px]"
          style={{width: 'calc((100% - 16px) / 3)'}}
          animate={{x: `${activeIndex * 100}%`}}
          transition={navPillTransition}
        />
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeTab(tab.id as TabType)}
              className={`pointer-events-auto group relative z-20 flex h-[62px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[20px] px-2.5 transition active:scale-[0.985] ${
                isActive ? 'text-slate-950' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              <Icon
                className={`h-5 w-5 shrink-0 transition ${
                  isActive ? 'text-vnt-primary' : 'text-slate-400 group-hover:text-slate-600'
                }`}
                strokeWidth={isActive ? 2.55 : 2.15}
              />
              <span className="font-sans text-[13px] font-black leading-none tracking-normal">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

const navPillTransition = {
  type: 'spring',
  stiffness: 360,
  damping: 34,
  mass: 0.88,
} as const;

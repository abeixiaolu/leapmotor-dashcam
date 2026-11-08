import Reset from "@carbon/icons-react/es/Reset.js";
import { Button } from "@/components/base/buttons/button";
import { Drawer, DrawerHeader } from "@/components/base/drawer/drawer";
import { Slider } from "@/components/base/slider/slider";
import { Switch } from "@/components/base/switch/switch";
import { ScrollFade, useScrollFade } from "@/components/foundations/scroll-fade/scroll-fade";
import type { CorrectionSettings } from "@/settings";
import "./settings-drawer.css";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: CorrectionSettings;
  onChange: (value: CorrectionSettings) => void;
  saved: boolean;
};

export function SettingsDrawer({ open, onOpenChange, value, onChange, saved }: Props) {
  const fade = useScrollFade();
  return (
    <Drawer
      placement="end"
      size="md"
      isOpen={open}
      onOpenChange={(next) => {
        fade.reset();
        onOpenChange(next);
      }}
      aria-label="设置"
      className="!gap-0 !py-0"
    >
      <DrawerHeader
        title="设置"
        description="调整回放画面，不修改原始录像。"
        closeLabel="关闭设置"
        className="drawer-panel-header"
      />
      <div className="relative min-h-0 flex-1">
        <div
          onScroll={fade.onScroll}
          className="h-full overflow-y-auto overscroll-contain px-6 py-6"
        >
          <section aria-labelledby="correction-settings-title" className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h2 id="correction-settings-title" className="text-body-medium text-text-primary">
                鱼眼画面校正
              </h2>
              <Button
                variant="ghost"
                size="small"
                leadingIcon={Reset}
                aria-label="重置校正参数"
                onClick={() => onChange({ ...value, fov: 95, strength: 1 })}
              >
                重置
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <Switch
                aria-label="鱼眼画面校正"
                isSelected={value.correct}
                onChange={(correct) => onChange({ ...value, correct })}
                size="sm"
                className="settings-switch flex h-8 w-full flex-row-reverse justify-between rounded-lg border border-border-button-default bg-background-primary-default px-2"
              >
                启用校正
              </Switch>
              <Slider
                label="视野角度"
                thumbLabel="视野角度"
                variant="field"
                minValue={60}
                maxValue={130}
                step={1}
                value={value.fov}
                formatValue={(n) => `${n}°`}
                isDisabled={!value.correct}
                onChange={(fov) => onChange({ ...value, fov })}
              />
              <Slider
                label="校正强度"
                thumbLabel="校正强度"
                variant="field"
                minValue={0}
                maxValue={1}
                step={0.01}
                value={value.strength}
                formatValue={(n) => `${Math.round(n * 100)}%`}
                isDisabled={!value.correct}
                onChange={(strength) => onChange({ ...value, strength })}
              />
            </div>
          </section>
        </div>
        <ScrollFade progress={fade.progress} />
      </div>
      {!saved && (
        <p
          role="status"
          className="border-t border-separator-border px-6 py-5 text-caption-1-regular text-text-secondary"
        >
          此浏览器无法保存设置，本次调整仍然有效。
        </p>
      )}
    </Drawer>
  );
}

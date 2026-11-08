import { Select, SelectItem } from "@/components/base/select/select";
import { Slider } from "@/components/base/slider/slider";
import { Switch } from "@/components/base/switch/switch";
import { cx } from "@/utils/cx";

export function PlayerSlider({
  label,
  value,
  min = 0,
  max,
  step = 1,
  disabled,
  onChange,
  className,
  showTooltip = false,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  className?: string;
  showTooltip?: boolean;
}) {
  return (
    <Slider
      aria-label={label}
      thumbLabel={label}
      minValue={min}
      maxValue={max}
      step={step}
      value={value}
      isDisabled={disabled}
      onChange={onChange}
      showTooltip={showTooltip}
      className={cx("min-w-0", className)}
    />
  );
}

export function PlaybackSpeed({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Select
      aria-label="播放倍速"
      selectedKey={String(value)}
      onSelectionChange={(key) => {
        if (key != null) onChange(Number(key));
      }}
      size="sm"
      className="w-auto"
      triggerClassName="min-w-[7.5rem] bg-neutral-800! border-neutral-600! text-neutral-100! shadow-none hover:bg-neutral-700! hover:border-neutral-500!"
      popoverClassName="z-[160]"
      renderValue={() => `${value}× 倍速`}
    >
      {[0.25, 0.5, 1, 1.5, 2, 4].map((rate) => (
        <SelectItem key={rate} id={String(rate)} textValue={`${rate}× 倍速`}>
          {rate}× 倍速
        </SelectItem>
      ))}
    </Select>
  );
}

export function CorrectionSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return <Switch isSelected={checked} onChange={onChange} size="md" aria-label="鱼眼画面校正" />;
}

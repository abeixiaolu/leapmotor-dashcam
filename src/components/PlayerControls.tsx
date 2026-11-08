import * as Slider from "@radix-ui/react-slider";
import * as Select from "@radix-ui/react-select";
import * as Switch from "@radix-ui/react-switch";
import { Check, ChevronRight } from "../icons";

export function PlayerSlider({
  label,
  value,
  min = 0,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Slider.Root
      className="control-slider"
      min={min}
      max={max}
      step={step}
      value={[value]}
      disabled={disabled}
      onValueChange={([next]) => onChange(next)}
    >
      <Slider.Track className="control-slider-track">
        <Slider.Range className="control-slider-range" />
      </Slider.Track>
      <Slider.Thumb className="control-slider-thumb" aria-label={label} />
    </Slider.Root>
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
    <Select.Root value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <Select.Trigger className="speed-trigger" aria-label="播放倍速">
        <Select.Value />
        <Select.Icon>
          <ChevronRight size={16} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="speed-menu"
          position="popper"
          side="top"
          align="end"
          sideOffset={8}
        >
          <Select.Viewport>
            {[0.25, 0.5, 1, 1.5, 2, 4].map((rate) => (
              <Select.Item className="speed-option" key={rate} value={String(rate)}>
                <Select.ItemText>{rate}× 倍速</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={16} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function CorrectionSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Switch.Root
      className="correction-switch"
      checked={checked}
      onCheckedChange={onChange}
      aria-label="鱼眼画面校正"
    >
      <Switch.Thumb className="correction-switch-thumb" />
    </Switch.Root>
  );
}

<script lang="ts">
  import { getSettingControl } from "./control-context";
  const settingControl = getSettingControl();

  // Range input + right-aligned readout, the shape every numeric setting uses.
  interface Props {
    min: number;
    max: number;
    step: number;
    value: number;
    onchange: (value: number) => void;
    /** Formatted readout (e.g. "13px", "unlimited"). */
    readout: string;
    /** Width class for the readout so columns line up within a group. */
    readoutClass?: string;
    disabled?: boolean;
  }

  let {
    min,
    max,
    step,
    value,
    onchange,
    readout,
    readoutClass = "w-12",
    disabled = false,
  }: Props = $props();
</script>

<input
  type="range"
  aria-labelledby={settingControl?.["aria-labelledby"]}
  aria-describedby={settingControl?.["aria-describedby"]}
  aria-valuetext={readout}
  {min}
  {max}
  {step}
  {value}
  {disabled}
  oninput={(e) => onchange(parseFloat(e.currentTarget.value))}
  class="w-32 accent-primary"
/>
<span class="{readoutClass} text-right text-sm tabular-nums">{readout}</span>

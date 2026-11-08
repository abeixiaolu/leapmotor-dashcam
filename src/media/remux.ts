import type { RecordedTiming } from "./timing";

// Match one recorded timestamp per packet before trusting the camera's timing.
export function remuxTiming(recorded: RecordedTiming | undefined, packets: number) {
  return recorded && recorded.frameCount === packets
    ? { numerator: recorded.fpsNumerator, denominator: recorded.fpsDenominator }
    : { numerator: 25, denominator: 1 };
}

export function remuxArguments(numerator: number, denominator: number) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-fflags",
    "+genpts",
    "-r",
    `${numerator}/${denominator}`,
    "-i",
    "/input/recording.h264",
    "-map",
    "0:v:0",
    "-c:v",
    "copy",
    "-bsf:v",
    `setts=time_base=1/${numerator}:ts=N*${denominator}:duration=${denominator}`,
    "-video_track_timescale",
    String(numerator),
    "-movflags",
    "+faststart",
    "output.mp4",
  ];
}

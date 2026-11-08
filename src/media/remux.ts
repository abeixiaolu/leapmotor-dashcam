import type { RecordedTiming } from "./timing";

// Match one recorded timestamp per packet before trusting the camera's timing.
export function remuxTiming(recorded: RecordedTiming | undefined, packets: number) {
  return recorded && recorded.frameCount === packets
    ? { numerator: recorded.fpsNumerator, denominator: recorded.fpsDenominator }
    : { numerator: 25, denominator: 1 };
}

export function remuxArguments(
  numerator: number,
  denominator: number,
  options: { faststart?: boolean } = {},
) {
  const faststart = options.faststart !== false;
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
    // Normalize the SPS as well as MP4 timestamps. Recorder streams can signal
    // Level 6.0 even when their dimensions/rate only require Level 5.0, which
    // can make hardware decoders reject an otherwise supported video.
    // Progressive H.264 uses two timing ticks per frame. Set timing before
    // automatic level detection so a malformed raw tick rate cannot inflate it.
    `h264_metadata=tick_rate=${2 * numerator}/${denominator}:level=auto,setts=time_base=1/${numerator}:ts=N*${denominator}:duration=${denominator}`,
    "-video_track_timescale",
    String(numerator),
    ...(faststart ? ["-movflags", "+faststart"] : []),
    "output.mp4",
  ];
}

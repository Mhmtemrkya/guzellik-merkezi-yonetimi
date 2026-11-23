import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('png')
Config.setOverwriteOutput(true)
// Sayfa videoyu KAYDIRMAYLA sarar (currentTime): sık anahtar kare şart, yoksa geri sarma takılır.
Config.overrideFfmpegCommand(({ type, args }) => {
  if (type !== 'stitcher') return args
  const out = args[args.length - 1]
  return [...args.slice(0, -1), '-g', '6', '-keyint_min', '6', '-sc_threshold', '0', '-movflags', '+faststart', out]
})

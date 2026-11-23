import { Composition } from 'remotion'
import { MaydiReel } from './MaydiReel'

export const RemotionRoot: React.FC = () => (
  <>
    {/* 4K kaynak; 1080p sürüm aynı kompozisyondan --scale=0.5 ile çizilir. */}
    <Composition id="MaydiReel" component={MaydiReel} durationInFrames={360} fps={30} width={3840} height={2160} />
  </>
)

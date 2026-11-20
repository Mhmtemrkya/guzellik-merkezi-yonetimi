'use client'

import { useEffect, useRef, useState } from 'react';
// Stiller global: app/maydi.css (root layout'tan yüklenir).

export type MaydiResponseMood = 'speaking' | 'happy' | 'guiding' | 'love';
export type MaydiMood = 'idle' | 'thinking' | MaydiResponseMood | 'love';
type Animation = MaydiMood | 'wink' | 'spin' | 'entrance';
const expressionNames: MaydiMood[] = ['thinking', 'speaking', 'happy', 'guiding', 'love'];
const reactionDuration: Partial<Record<Animation, number>> = { speaking: 3200, happy: 2200, guiding: 4200, love: 4000 };

interface MaydiMascotProps {
  /** Height in CSS pixels. The transparent artwork has a 4:5 aspect ratio. */
  size?: number;
  thinking?: boolean;
  /** Explicit pose for previews and static avatars; idle follows normal activity. */
  mood?: MaydiMood;
  /** Change this value to play one full 3D turn. */
  spinSignal?: number;
  /** Change this value to rise from the platform, turn, then wink. */
  entranceSignal?: number;
  platform?: boolean;
  /** A new response ID presents its text, directions, or successful action. */
  responseId?: string;
  responseMood?: MaydiResponseMood;
  affectionSignal?: number;
  animated?: boolean;
  className?: string;
}

const assets = '/mascots/maydi';

/** SchoolAsist Maydi maskotu: orijinal 3B modelden ön işlenmiş görseller; WebGL ya da çalışma anında model indirme yok. */
export default function MaydiMascot({
  size = 64, thinking = false, mood = 'idle', spinSignal = 0, entranceSignal = 0, platform = false,
  responseId, responseMood = 'speaking', affectionSignal = 0, animated = true, className = '',
}: MaydiMascotProps) {
  const [animation, setAnimation] = useState<Animation>('idle');
  // SSR: window/document yok — ilk çizimde hareketsiz, istemcide hemen gerçek değer okunur.
  const [reducedMotion, setReducedMotion] = useState(() => typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const [spinReady, setSpinReady] = useState(false);
  const [affectionPlay, setAffectionPlay] = useState(0);
  const lastSpin = useRef(spinSignal);
  const lastEntrance = useRef(entranceSignal);
  const lastResponse = useRef(responseId);
  const lastAffection = useRef(affectionSignal);
  const pendingAffection = useRef(false);
  const canAnimate = animated && !reducedMotion && visible;

  useEffect(() => {
    if (!animated) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(preference.matches);
    setVisible(document.visibilityState !== 'hidden');
    const onPreference = () => setReducedMotion(preference.matches);
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    preference.addEventListener('change', onPreference);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      preference.removeEventListener('change', onPreference);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [animated]);

  useEffect(() => {
    if (!animated) return;
    let active = true;
    for (const name of ['spin', 'wink', ...expressionNames, ...expressionNames.map((name) => `${name}-loop`)]) {
      const image = new Image();
      if (name === 'spin') image.onload = () => { if (active) setSpinReady(true); };
      image.src = `${assets}/${name}.webp`;
    }
    return () => { active = false; };
  }, [animated]);

  useEffect(() => {
    if (!canAnimate || thinking || mood !== 'idle') {
      setAnimation('idle');
      return;
    }
    const timer = window.setInterval(() => {
      setAnimation((current) => current === 'idle' ? 'wink' : current);
    }, 6200);
    return () => window.clearInterval(timer);
  }, [canAnimate, thinking, mood]);

  useEffect(() => {
    if (spinSignal === lastSpin.current) return;
    if (!canAnimate || thinking) {
      lastSpin.current = spinSignal;
      return;
    }
    // Preserve the first interaction until the turntable is ready to display it.
    if (!spinReady) return;
    lastSpin.current = spinSignal;
    setAnimation((current) => current === 'entrance' || current === 'love' ? current : 'spin');
  }, [spinSignal, canAnimate, thinking, spinReady]);

  useEffect(() => {
    if (!canAnimate || thinking) {
      lastEntrance.current = entranceSignal;
      return;
    }
    if (entranceSignal !== lastEntrance.current && spinReady) {
      lastEntrance.current = entranceSignal;
      setAnimation('entrance');
    }
  }, [entranceSignal, canAnimate, thinking, spinReady]);

  useEffect(() => {
    if (responseId && responseId !== lastResponse.current && animated && visible && !thinking) {
      setAnimation((current) => current === 'love' ? current : responseMood);
      if (responseMood === 'love') setAffectionPlay((current) => current + 1);
    }
    if (!thinking) lastResponse.current = responseId;
  }, [responseId, responseMood, animated, visible, thinking]);

  useEffect(() => {
    if (affectionSignal !== lastAffection.current) pendingAffection.current = true;
    lastAffection.current = affectionSignal;
    // A like on an older reply can arrive while the next request is still running.
    // Keep that acknowledgement until the visible mascot can actually show it.
    if (pendingAffection.current && animated && visible && !thinking) {
      pendingAffection.current = false;
      setAnimation('love');
      setAffectionPlay((current) => current + 1);
    }
  }, [affectionSignal, animated, visible, thinking]);

  useEffect(() => {
    const duration = reactionDuration[animation];
    if (!duration) return;
    const timer = window.setTimeout(() => setAnimation('idle'), duration);
    return () => window.clearTimeout(timer);
  }, [animation, affectionPlay]);

  const expression = thinking ? 'thinking' : mood !== 'idle' ? mood : animated ? animation : 'idle';
  const image = expression === 'entrance' ? 'spin' : canAnimate && expressionNames.includes(expression as MaydiMood) ? `${expression}-loop` : expression;

  return (
    <span aria-hidden="true" data-maydi-state={expression}
      className={`maydi-mascot ${canAnimate ? 'maydi-mascot--animated' : ''} ${platform ? 'maydi-mascot--platform' : ''} ${expression === 'entrance' ? 'maydi-mascot--entrance' : ''} ${className}`}
      style={{ width: size * 0.8, height: size }}>
      {platform ? (
        <>
          <span className="maydi-mascot__projection" />
          <span className="maydi-mascot__platform">
            <span className="maydi-mascot__platform-surface">
              <span className="maydi-mascot__platform-orbit" />
              <span className="maydi-mascot__platform-lens" />
            </span>
            <span className="maydi-mascot__platform-edge" />
          </span>
        </>
      ) : null}
      <span className="maydi-mascot__viewport">
        <span className="maydi-mascot__rise">
          <span className="maydi-mascot__float">
            <span key={expression} className={`maydi-mascot__art maydi-mascot__art--${expression}`}
              style={{ backgroundImage: `url("${assets}/${image}.webp")` }}
              onAnimationEnd={(event) => {
                if (event.target !== event.currentTarget) return;
                setAnimation(expression === 'entrance' ? 'wink' : 'idle');
              }} />
          </span>
        </span>
      </span>
    </span>
  );
}

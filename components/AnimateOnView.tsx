'use client';

import type { AriaRole, CSSProperties, ReactNode } from 'react';
import { useId, useMemo } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { cn } from '@/lib/utils';

export type AnimateOnViewAnimation =
  | 'fade'
  | 'fade-up'
  | 'fade-down'
  | 'fade-left'
  | 'fade-right'
  | 'blur-up'
  | 'scale'
  | 'pop'
  | 'soft';

type AnimateOnViewElement = 'div' | 'section' | 'article' | 'li';

interface AnimateOnViewProps {
  children: ReactNode;
  as?: AnimateOnViewElement;
  id?: string;
  role?: AriaRole;
  style?: CSSProperties;
  className?: string;
  animation?: AnimateOnViewAnimation | 'random';
  randomKey?: string;
  randomPool?: AnimateOnViewAnimation[];
  delay?: number;
  duration?: number;
  distance?: number;
  once?: boolean;
  amount?: number;
  margin?: string;
  disabled?: boolean;
}

const defaultRandomPool: AnimateOnViewAnimation[] = ['fade-up', 'scale', 'pop', 'soft'];

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const buildVariants = (animation: AnimateOnViewAnimation, distance: number, reducedMotion: boolean): Variants => {
  if (reducedMotion) {
    return {
      hidden: { opacity: 0 },
      visible: { opacity: 1 },
    };
  }

  const variants: Record<AnimateOnViewAnimation, Variants> = {
    fade: {
      hidden: { opacity: 0 },
      visible: { opacity: 1 },
    },
    'fade-up': {
      hidden: { opacity: 0, y: distance },
      visible: { opacity: 1, y: 0 },
    },
    'fade-down': {
      hidden: { opacity: 0, y: -distance },
      visible: { opacity: 1, y: 0 },
    },
    'fade-left': {
      hidden: { opacity: 0, x: distance },
      visible: { opacity: 1, x: 0 },
    },
    'fade-right': {
      hidden: { opacity: 0, x: -distance },
      visible: { opacity: 1, x: 0 },
    },
    'blur-up': {
      hidden: { opacity: 0, y: distance, filter: 'blur(12px)' },
      visible: { opacity: 1, y: 0, filter: 'blur(0px)' },
    },
    scale: {
      hidden: { opacity: 0, scale: 0.96 },
      visible: { opacity: 1, scale: 1 },
    },
    pop: {
      hidden: { opacity: 0, y: distance * 0.55, scale: 0.94 },
      visible: { opacity: 1, y: 0, scale: 1 },
    },
    soft: {
      hidden: { opacity: 0, y: distance * 0.65, scale: 0.985 },
      visible: { opacity: 1, y: 0, scale: 1 },
    },
  };

  return variants[animation];
};

export function AnimateOnView({
  children,
  as = 'div',
  animation = 'fade-up',
  randomKey,
  randomPool = defaultRandomPool,
  delay = 0,
  duration = 0.7,
  distance = 24,
  once = true,
  amount = 0.18,
  margin = '0px 0px -80px 0px',
  disabled = false,
  className,
  ...props
}: AnimateOnViewProps) {
  const generatedId = useId();
  const shouldReduceMotion = useReducedMotion();

  const resolvedAnimation = useMemo<AnimateOnViewAnimation>(() => {
    if (animation !== 'random') return animation;
    const pool = randomPool.length > 0 ? randomPool : defaultRandomPool;
    const seed = randomKey ?? generatedId;
    return pool[hashString(seed) % pool.length];
  }, [animation, generatedId, randomKey, randomPool]);

  const variants = useMemo(
    () => buildVariants(resolvedAnimation, distance, Boolean(shouldReduceMotion)),
    [distance, resolvedAnimation, shouldReduceMotion],
  );

  const MotionComponent =
    as === 'section' ? motion.section : as === 'article' ? motion.article : as === 'li' ? motion.li : motion.div;

  if (disabled) {
    const Component = as;
    return (
      <Component className={className} {...props}>
        {children}
      </Component>
    );
  }

  return (
    <MotionComponent
      className={cn('will-change-transform', className)}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, amount, margin }}
      variants={variants}
      transition={{
        duration: shouldReduceMotion ? 0.2 : duration,
        delay: shouldReduceMotion ? 0 : delay,
        ease: [0.22, 1, 0.36, 1],
      }}
      {...props}
    >
      {children}
    </MotionComponent>
  );
}

import React from 'react';

/**
 * The app's button. Colours come from `variant` and padding, text size and
 * shape from `size`, so buttons share one definition of each style.
 *
 * No variant shows a border until hovered or focused. Each keeps a transparent
 * 1px border so hovering doesn't shift layout.
 *
 * `className` adds to these rather than overriding them: classes that set the
 * same property as the variant or size (say `px-2` on a `sm` button) win or
 * lose by stylesheet order, not by where they appear. For a button laid out
 * like the links around it, such as a menu row, use `size="none"` and give the
 * padding, text size and shape in `className`.
 */

const VARIANTS = {
  secondary: 'bg-secondary text-foreground border-transparent enabled:hover:border-ring focus-visible:border-ring',
  ghost: 'text-foreground border-transparent enabled:hover:border-ring focus-visible:border-ring',
  destructive:
    'text-destructive border-transparent enabled:hover:border-destructive focus-visible:border-destructive',
};

const SIZES = {
  sm: 'justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold',
  md: 'justify-center gap-1.5 rounded px-4 py-2.5 text-sm font-semibold',
  none: '',
};

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

/** Button's classes, for elements that can't be a Button. */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md') {
  return `inline-flex items-center border cursor-pointer transition-colors focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]}`;
}

interface Props extends React.ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export default function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className = '',
  ...props
}: Props) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...props} />;
}

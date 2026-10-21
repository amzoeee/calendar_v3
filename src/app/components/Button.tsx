import React from 'react';

/**
 * The app's button. Colours come from `variant` and padding, text size and
 * shape from `size`, so buttons share one definition of each style.
 *
 * `className` adds to these rather than overriding them: classes that set the
 * same property as the variant or size (say `px-2` on a `sm` button) win or
 * lose by stylesheet order, not by where they appear. For a button laid out
 * like the links around it, such as a menu row, use `size="none"` and give the
 * padding, text size and shape in `className`.
 */

const VARIANTS = {
  primary: 'bg-primary text-primary-foreground hover:bg-muted',
  secondary: 'bg-secondary text-foreground hover:bg-muted',
  ghost: 'text-foreground hover:bg-secondary',
  destructive: 'btn-destructive',
};

const SIZES = {
  sm: 'justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold',
  md: 'justify-center gap-1.5 rounded px-4 py-2.5 text-sm font-semibold',
  none: '',
};

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

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
  return (
    <button
      type={type}
      className={`inline-flex items-center cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}

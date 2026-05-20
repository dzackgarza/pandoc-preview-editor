import * as ToastPrimitives from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from './utils.js';

export const ToastProvider = ToastPrimitives.Provider;

export const ToastViewport = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>) => (
  <ToastPrimitives.Viewport
    className={cn(
      'fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]',
      className,
    )}
    {...props}
  />
);

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border p-4 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none',
  {
    variants: {
      variant: {
        default: 'border-[#2d5438] bg-[#192b21] text-[#d2f0d4]',
        destructive: 'border-[#542d2d] bg-[#2b1919] text-[#f0c2c2]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export const Toast = ({
  className,
  variant,
  ...props
}: React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> &
  VariantProps<typeof toastVariants>) => (
  <ToastPrimitives.Root
    className={cn(toastVariants({ variant }), className)}
    {...props}
  />
);

export const ToastClose = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>) => (
  <ToastPrimitives.Close
    className={cn(
      'absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100',
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
);

export const ToastTitle = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>) => (
  <ToastPrimitives.Title
    className={cn('text-sm font-semibold', className)}
    {...props}
  />
);

export const ToastDescription = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>) => (
  <ToastPrimitives.Description
    className={cn('text-sm opacity-90', className)}
    {...props}
  />
);

export { type VariantProps };

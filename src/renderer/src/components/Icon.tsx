import { cx } from './cx'

/**
 * Small hand-drawn stroke icon set (24 × 24 grid, round caps) so the app needs no icon
 * dependency. Add a path here rather than importing an icon library.
 */
const paths = {
  library: 'M5 4h3.5v16H5zM10.5 4H14v16h-3.5zM16.2 6.2l3.1-.8 3.2 13.6-3.1.8z',
  review: 'M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5',
  planner:
    'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 9.5h16M8.5 3v4M15.5 3v4M9 15l2 2 4-4',
  settings:
    'M4 7h9M17 7h3M4 17h3M11 17h9M15 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  search: 'M11 5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM20 20l-4.6-4.6',
  import: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  'zoom-in': 'M11 5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM20 20l-4.6-4.6M8.5 11h5M11 8.5v5',
  'zoom-out': 'M11 5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM20 20l-4.6-4.6M8.5 11h5',
  'fit-width': 'M4 5v14M20 5v14M7.5 12h9M10 9.5 7.5 12l2.5 2.5M14 9.5l2.5 2.5-2.5 2.5',
  'panel-left': 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 4v16',
  'panel-right': 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM15 4v16',
  close: 'M6 6l12 12M18 6 6 18',
  alert: 'M10.3 4.9a2 2 0 0 1 3.4 0l7.3 12.6a2 2 0 0 1-1.7 3H4.7a2 2 0 0 1-1.7-3zM12 10v4M12 17.2v.1',
  clock: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8v4l2.5 2.5',
  check: 'M5 12.5 9.5 17 19 7.5',
  notes: 'M6.5 3H15l4 4v13a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14.5 3v4.5H19M9 12h7M9 16h5',
  target: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 11.5v1',
  cards:
    'M8.5 4H18a2 2 0 0 1 2 2v9M6 7.5h9.5a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2z',
  book: 'M4 5a2 2 0 0 1 2-2h5v17H6a2 2 0 0 0-2 2zM20 5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2z',
  bookmark: 'M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.4 9.2a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.3-2.6 3.9M12 17h.01',
  chat: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  map: 'M9 4 3.5 6.2v13.6L9 17.6l6 2.4 5.5-2.2V4.2L15 6.4zM9 4v13.6M15 6.4V20',
  pause: 'M8.5 5v14M15.5 5v14',
  play: 'M7.5 5.5v13l11-6.5z',
  flag: 'M5.5 21V4M5.5 4.5h11l-2.2 4 2.2 4h-11',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z',
  monitor: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 21h6M12 17v4',
  file: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5',
  external: 'M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  sparkle:
    'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9zM18.5 16.5l.8 2 2 .7-2 .8-.8 2-.7-2-2-.8 2-.7z',
  pin: 'M9 3.5h6M10 3.5v5.5l-3 3.5h10l-3-3.5V3.5M12 12.5V21',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  pencil: 'M15.5 5.5l3 3M4.5 19.5l1-4 10.6-10.6a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L8.5 18.5z'
} as const

export type IconName = keyof typeof paths

interface IconProps {
  name: IconName
  /** Pixel size; icons scale with stroke kept optically even. */
  size?: number
  className?: string
  /** Leave undefined for decorative icons (the default); set for standalone meaning. */
  title?: string
}

export function Icon({ name, size = 18, className, title }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size <= 16 ? 2 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('shrink-0', className)}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={paths[name]} />
    </svg>
  )
}

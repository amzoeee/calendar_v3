// Every feature the app records use of. The admin page lists all of these,
// including ones nobody has used, so zero counts show up too.
export const USAGE_CATALOG = {
  'view.daily': { group: 'Views', label: 'Daily view' },
  'view.weekly': { group: 'Views', label: 'Weekly view (mobile = agenda)' },
  'view.tasks': { group: 'Views', label: 'Tasks' },
  'view.stats': { group: 'Views', label: 'Weekly stats' },
  'view.lifetime': { group: 'Views', label: 'Lifetime stats' },
  'view.settings': { group: 'Views', label: 'Settings' },

  'nav.mini_calendar': { group: 'Navigation', label: 'Mini calendar' },
  'nav.keyboard': { group: 'Navigation', label: 'Arrow keys between days/weeks' },
  'nav.swipe': { group: 'Navigation', label: 'Swipe between days/weeks' },
  'nav.zoom_key': { group: 'Navigation', label: 'Zoom with Cmd/Ctrl + / -' },
  'nav.zoom_reset': { group: 'Navigation', label: 'Zoom reset with Cmd/Ctrl 0' },
  'nav.pinch_zoom': { group: 'Navigation', label: 'Pinch zoom' },
  'nav.search': { group: 'Navigation', label: 'Event search (opened a result)' },

  'event.create': { group: 'Events', label: 'Create event' },
  'event.edit': { group: 'Events', label: 'Edit event' },
  'event.delete': { group: 'Events', label: 'Delete event' },
  'event.copy': { group: 'Events', label: 'Copy event' },
  'event.series_edit': { group: 'Events', label: 'Edit recurring series' },
  'event.series_delete': { group: 'Events', label: 'Delete recurring series' },

  'import.paste_log': { group: 'Logging import', label: 'Paste log in settings' },
  'import.approve': { group: 'Logging import', label: 'Approve pending' },
  'import.discard': { group: 'Logging import', label: 'Discard pending' },
  'import.override_date': { group: 'Logging import', label: 'Override pending date' },
  'discord.link': { group: 'Logging import', label: 'Redeem /link code' },
  'discord.unlink': { group: 'Logging import', label: 'Unlink Discord' },

  'bot.fetch': { group: 'Discord bot', label: '/fetch' },
  'bot.manual_fetch': { group: 'Discord bot', label: '/manual-fetch' },
  'bot.debug_fetch': { group: 'Discord bot', label: '/debug-fetch' },
  'bot.log': { group: 'Discord bot', label: '/log' },
  'bot.link': { group: 'Discord bot', label: '/link' },
  'bot.whoami': { group: 'Discord bot', label: '/whoami' },
  'bot.marker': { group: 'Discord bot', label: '/marker' },
  'bot.clear': { group: 'Discord bot', label: '/clear' },
  'bot.clear_button': { group: 'Discord bot', label: 'Clear button under /fetch' },
  'bot.delete_log_button': { group: 'Discord bot', label: 'Delete log button' },

  'ics.import': { group: 'Import / export', label: 'Google Calendar import' },
  'ics.export': { group: 'Import / export', label: 'Export one tag (.ics)' },
  'ics.export_zip': { group: 'Import / export', label: 'Export several tags (ZIP)' },

  'tag.create': { group: 'Tags', label: 'Create tag' },
  'tag.edit': { group: 'Tags', label: 'Edit tag' },
  'tag.archive': { group: 'Tags', label: 'Archive / unarchive tag' },
  'tag.reorder': { group: 'Tags', label: 'Reorder tags' },
  'tag.delete': { group: 'Tags', label: 'Delete tag' },

  'stats.preset': { group: 'Stats', label: 'Range preset' },
  'stats.weekdays_only': { group: 'Stats', label: 'Weekdays-only filter' },
  'lifetime.search': { group: 'Stats', label: 'Lifetime search' },
  'lifetime.range': { group: 'Stats', label: 'Lifetime range' },
  'lifetime.bulk_edit': { group: 'Stats', label: 'Lifetime bulk rename / retag' },

  'task.create': { group: 'Tasks', label: 'Create task' },
  'task.bulk_create': { group: 'Tasks', label: 'Bulk-create importer' },
  'task.edit': { group: 'Tasks', label: 'Edit task' },
  'task.complete': { group: 'Tasks', label: 'Complete / uncomplete' },
  'task.delete': { group: 'Tasks', label: 'Delete task' },
  'task.move': { group: 'Tasks', label: 'Drag to reorder / nest' },
  'task.move_board': { group: 'Tasks', label: 'Move to another list' },
  'task.star': { group: 'Tasks', label: 'Star / unstar' },
  'task.tags': { group: 'Tasks', label: 'Set task tags' },
  'task.schedule': { group: 'Tasks', label: 'Set deadline / reminder' },
  'task.recurrence': { group: 'Tasks', label: 'Set recurrence' },
  'task.skip': { group: 'Tasks', label: 'Skip occurrence' },
  'task.postpone': { group: 'Tasks', label: 'Postpone occurrence' },
  'task.restore_deadline': { group: 'Tasks', label: 'Restore deadline' },
  'task.reminder_toggle': { group: 'Tasks', label: 'Turn reminder on / off' },
  'task.delete_completed': { group: 'Tasks', label: 'Delete completed' },
  'board.create': { group: 'Tasks', label: 'Create list' },
  'board.rename': { group: 'Tasks', label: 'Rename list' },
  'board.reorder': { group: 'Tasks', label: 'Reorder lists' },
  'board.default': { group: 'Tasks', label: 'Set default list' },
  'board.sort': { group: 'Tasks', label: 'Change list sort mode' },
  'board.delete': { group: 'Tasks', label: 'Delete list' },

  'undo.event': { group: 'Undo', label: 'Undo event delete' },
  'undo.tag': { group: 'Undo', label: 'Undo tag delete' },
  'undo.task': { group: 'Undo', label: 'Undo task delete' },
  'undo.board': { group: 'Undo', label: 'Undo list delete' },

  'auth.login': { group: 'Account', label: 'Log in' },
  'auth.register': { group: 'Account', label: 'Register' },
  'account.change_password': { group: 'Account', label: 'Change password' },
} as const satisfies Record<string, { group: string; label: string }>;

export type UsageName = keyof typeof USAGE_CATALOG;

export function isUsageName(name: unknown): name is UsageName {
  return typeof name === 'string' && Object.hasOwn(USAGE_CATALOG, name);
}

export type UsageProps = Record<string, string | number | boolean>;

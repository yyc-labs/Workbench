export const IPC = {
  DETECT_DIRECTORY: 'detect:directory',
  PROCESS_START: 'process:start',
  PROCESS_STOP: 'process:stop',
  PROCESS_INPUT: 'process:input',
  PROCESS_OUTPUT: 'process:output',
  PROCESS_STATUS: 'process:status',
  PROCESS_EXIT: 'process:exit',
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  DIALOG_SELECT_DIRECTORY: 'dialog:selectDirectory',
} as const

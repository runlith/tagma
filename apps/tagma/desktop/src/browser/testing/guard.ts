import { dialog } from 'electron';

process.on('uncaughtException', (error) => {
  console.error(error);
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  console.error(error);
  process.exit(1);
});

dialog.showErrorBox = (title, content) => console.error(`${title}: ${content}`);

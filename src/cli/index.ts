import { main } from './main';

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `scriptvet: unexpected error: ${(error as Error)?.stack ?? String(error)}\n`,
    );
    process.exitCode = 2;
  },
);

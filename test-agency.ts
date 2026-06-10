import { getAgency } from './src/lib/agency';
import { chatOnce } from './src/lib/chat';

async function main() {
  try {
    process.stderr.write('Starting test...\n');
    const agency = getAgency();
    process.stderr.write('Agency created\n');

    process.stderr.write('Chatting with Alice...\n');
    const result = await chatOnce('Alice', '你好，请用一句话介绍你自己');
    process.stderr.write('Reply: ' + result.reply + '\n');
  } catch (e: any) {
    process.stderr.write('Error: ' + e.message + '\n');
  }
}

main();

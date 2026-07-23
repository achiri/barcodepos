// BarcodePOS — Launch Vite Dev Server + Public Tunnel
// Run: npm run host   (or: node launch.js)
import { createServer } from 'vite';
import localtunnel from 'localtunnel';

const PORT = 3000;

const server = await createServer({ server: { port: PORT } });
await server.listen();
server.printUrls();

console.log('\n🌐 Creating public tunnel...');
try {
  const tunnel = await localtunnel({ port: PORT, subdomain: 'barcodepos-africa' });
  console.log(`\n📱 OPEN THIS ON YOUR PHONE:\n   ${tunnel.url}\n`);
  console.log('⚠️  First visit: you may see a confirmation page. Enter the IP shown, click Continue.\n');
  tunnel.on('close', () => console.log('Tunnel closed'));
  tunnel.on('error', (err) => console.log('⚠️  Tunnel error:', err.message));
} catch (err) {
  console.log('⚠️  Tunnel unavailable:', err.message);
  console.log('   You can still test over local WiFi — but the camera requires HTTPS or localhost,');
  console.log('   so scanning will only work by opening this URL directly on the same machine.');
}

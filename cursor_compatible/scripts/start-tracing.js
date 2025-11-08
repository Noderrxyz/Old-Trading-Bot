#!/usr/bin/env node
/**
 * Script to start the tracing infrastructure with Docker Compose
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Path to the tracing Docker Compose file
const composeFile = join(rootDir, 'docker-compose.tracing.yml');

// Check if Docker Compose file exists
if (!fs.existsSync(composeFile)) {
  console.error(`Error: Docker Compose file not found at ${composeFile}`);
  process.exit(1);
}

// Function to run Docker Compose command
function runDockerCompose(args) {
  console.log(`Running: docker-compose -f ${composeFile} ${args.join(' ')}`);
  
  const dockerCompose = spawn('docker-compose', ['-f', composeFile, ...args], {
    stdio: 'inherit',
    shell: true
  });
  
  dockerCompose.on('error', (error) => {
    console.error('Failed to start Docker Compose:', error.message);
    process.exit(1);
  });
  
  return new Promise((resolve, reject) => {
    dockerCompose.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker Compose exited with code ${code}`));
      }
    });
  });
}

// Main function
async function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const command = args.length > 0 ? args[0] : 'up';
    
    switch (command) {
      case 'up':
        console.log('Starting Noderr tracing infrastructure...');
        await runDockerCompose(['up', '-d']);
        console.log('\nTracing infrastructure started successfully!');
        console.log('- Jaeger UI:      http://localhost:16686');
        console.log('- Kibana:         http://localhost:5601');
        console.log('- Elasticsearch:  http://localhost:9200');
        console.log('\nUse \'node scripts/start-tracing.js down\' to stop the services.');
        break;
        
      case 'down':
        console.log('Stopping Noderr tracing infrastructure...');
        await runDockerCompose(['down']);
        console.log('Tracing infrastructure stopped successfully.');
        break;
        
      case 'logs':
        await runDockerCompose(['logs', '-f']);
        break;
        
      case 'restart':
        console.log('Restarting Noderr tracing infrastructure...');
        await runDockerCompose(['restart']);
        console.log('Tracing infrastructure restarted successfully.');
        break;
        
      default:
        console.log(`Unknown command: ${command}`);
        console.log('Available commands: up, down, logs, restart');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the main function
main().catch(console.error); 
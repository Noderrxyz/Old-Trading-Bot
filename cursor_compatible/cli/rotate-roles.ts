#!/usr/bin/env ts-node

/**
 * Role Rotation CLI Script
 * 
 * Convenience script to run the rotate-roles command.
 */

import { command } from './commands/rotate_roles.js';

// Parse command line arguments
command.parse(process.argv); 
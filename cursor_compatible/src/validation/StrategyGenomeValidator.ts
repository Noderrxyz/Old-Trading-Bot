import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { StrategyGenome } from '../evolution/StrategyGenome.js';
import logger from '../utils/logger.js';

const ajv = new Ajv.default();
addFormats.default(ajv);

const genomeSchema = require('../schemas/StrategyGenome.schema.json');

export class StrategyGenomeValidator {
  private static instance: StrategyGenomeValidator;
  private validate: Ajv.ValidateFunction;

  private constructor() {
    this.validate = ajv.compile(genomeSchema);
  }

  public static getInstance(): StrategyGenomeValidator {
    if (!StrategyGenomeValidator.instance) {
      StrategyGenomeValidator.instance = new StrategyGenomeValidator();
    }
    return StrategyGenomeValidator.instance;
  }

  public validateGenome(genome: StrategyGenome): boolean {
    const isValid = this.validate(genome);
    if (!isValid) {
      logger.error('Strategy genome validation failed:', this.validate.errors);
    }
    return isValid;
  }

  public validateParameterValue(paramName: string, value: any): boolean {
    const paramSchema = genomeSchema.properties.parameters.additionalProperties;
    return ajv.validate(paramSchema, { value, locked: false });
  }
} 
import { 
  telemetry, 
  trace, 
  TraceFunctions, 
  SeverityLevel, 
  ConsoleExporter,
  JsonExporter
} from '../index';

// Initialize telemetry with different exporters
const consoleExporter = new ConsoleExporter({
  detailedMetrics: true,
  minErrorSeverity: SeverityLevel.WARNING
});

const jsonExporter = new JsonExporter({
  outputDir: './logs',
  rotateDaily: true
});

// Register exporters
telemetry.registerExporter(consoleExporter);
telemetry.registerExporter(jsonExporter);

// Update telemetry configuration
telemetry.updateConfig({
  enabled: true,
  defaultLabels: {
    service: 'noderr-trading-bot',
    env: 'development'
  }
});

// Example class with traced methods
class ExampleService {
  private componentName = 'ExampleService';

  // Using function calling for tracing instead of decorator
  async fetchData(id: string): Promise<any> {
    return TraceFunctions.traceAsync(
      'ExampleService',
      'fetchData',
      async () => {
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
        
        // Simulate random error
        if (Math.random() < 0.2) {
          throw new Error(`Failed to fetch data for id: ${id}`);
        }
        
        return { id, data: 'sample data' };
      },
      {
        category: 'data',
        tags: { operation: 'fetch' }
      }
    );
  }

  // Example of a synchronous method with tracing
  processData(data: any): any {
    return TraceFunctions.traceSync(
      'ExampleService',
      'processData',
      () => {
        // Simulate data processing
        if (!data) {
          throw new Error('Cannot process null data');
        }
        
        // Record a custom metric during processing
        telemetry.recordMetric('example_service.data_size', 
          JSON.stringify(data).length, 
          { dataType: typeof data }
        );
        
        return { 
          processed: true, 
          result: `Processed: ${JSON.stringify(data)}` 
        };
      },
      {
        category: 'processing',
        recordErrors: true,
        errorSeverity: SeverityLevel.ERROR
      }
    );
  }

  // Example of manual trace usage for a complex function
  async complexOperation(params: any): Promise<any> {
    return TraceFunctions.traceAsync(
      this.componentName,
      'complexOperation',
      async () => {
        // First step - fetch data
        const data = await this.fetchData(params.id);
        
        // Record intermediate metric
        telemetry.recordMetric(
          'complex_operation.intermediate_step', 
          1, 
          { status: 'data_fetched' }
        );
        
        // Second step - process data
        const processed = this.processData(data);
        
        // Record custom error if needed
        if (processed.warnings) {
          telemetry.recordError(
            this.componentName,
            new Error('Processing completed with warnings'),
            SeverityLevel.WARNING,
            { 
              operation: 'complexOperation',
              warningCount: processed.warnings.length
            }
          );
        }
        
        return processed;
      },
      {
        category: 'operations',
        tags: { 
          operationType: 'complex',
          params: JSON.stringify(params)
        }
      }
    );
  }
}

// Example usage
async function runExample() {
  console.log('Starting telemetry example...');
  
  const service = new ExampleService();
  
  // Run multiple operations to generate metrics
  for (let i = 0; i < 5; i++) {
    try {
      console.log(`\nRunning operation ${i+1}:`);
      
      const result = await service.complexOperation({ id: `item-${i}` });
      console.log(`Operation completed: ${result.processed}`);
    } catch (error: any) {
      console.error(`Operation failed: ${error.message}`);
    }
    
    // Add some delay between operations
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Record some custom metrics
  telemetry.recordMetric('example.total_operations', 5);
  telemetry.recordMetric('example.success_rate', 0.8);
  
  console.log('\nExample completed. Check the telemetry output above.');
}

// Run the example
runExample().catch((error: any) => console.error(error)); 
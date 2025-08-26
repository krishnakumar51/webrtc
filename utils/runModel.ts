import { InferenceSession, Tensor } from "onnxruntime-web";

async function loadModelWithRetry(modelPath: string, options: InferenceSession.SessionOptions, maxRetries: number = 3): Promise<InferenceSession> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Loading attempt ${attempt}/${maxRetries}`);
      const session = await InferenceSession.create(modelPath, options);
      return session;
    } catch (error) {
      console.warn(`❌ Attempt ${attempt} failed:`, error);
      if (attempt === maxRetries) throw error;
      
      // Wait before retry with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

export async function createModelCpu(
  url: string
): Promise<InferenceSession> {
  console.log('🔧 Creating ONNX session with URL:', url);
  
  // Check memory constraints
  if ('memory' in performance && (performance as any).memory) {
    const memInfo = (performance as any).memory;
    console.log('💾 Memory info:', {
      used: Math.round(memInfo.usedJSHeapSize / 1024 / 1024) + 'MB',
      total: Math.round(memInfo.totalJSHeapSize / 1024 / 1024) + 'MB',
      limit: Math.round(memInfo.jsHeapSizeLimit / 1024 / 1024) + 'MB'
    });
  }
  
  // Detect iOS/Safari to prefer WASM over WebGL for stability
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);

  // Simplified execution providers for better compatibility
  const executionProviders = (isIOS || isSafari)
    ? [ 'wasm', 'cpu' ] // Skip WebGL on iOS/Safari for stability
    : [ 'wasm', 'cpu' ]; // Use WASM first, fallback to CPU
  
  for (const provider of executionProviders) {
    try {
      console.log(`🔄 Attempting to create session with ${provider} provider...`);

      const session = await loadModelWithRetry(url, {
        executionProviders: [provider],
        graphOptimizationLevel: 'basic', // Use basic optimization for better compatibility
      });
      
      console.log(`✅ Successfully created session with ${provider} provider`);
      return session;
    } catch (err: any) {
      console.warn(`❌ ${provider} EP failed to initialize:`, err?.message || err);
      
      // Log specific error types for debugging
      if (err instanceof Error) {
        if (err.message.toLowerCase().includes('memory')) {
          console.warn('🧠 Memory-related error detected');
        }
        if (err.message.includes('SharedArrayBuffer')) {
          console.warn('🔒 SharedArrayBuffer not available - check cross-origin headers');
        }
      }
      
      if (provider === executionProviders[executionProviders.length - 1]) {
        throw new Error(`All execution providers failed. Last error: ${err}`);
      }
    }
  }
  
  throw new Error('No execution providers available');
}

export async function runModel(
  model: InferenceSession,
  preprocessedData: Tensor
): Promise<[Tensor, number]> {
  
  try {
    const feeds: Record<string, Tensor> = {};
    feeds[model.inputNames[0]] = preprocessedData;
    const start = Date.now();
    const outputData = await model.run(feeds);
    const end = Date.now();
    const inferenceTime = end - start;
    const output = outputData[model.outputNames[0]] as Tensor;
    return [output, inferenceTime];
  } catch (e) {
    console.error(e);
    throw new Error();
  }
}

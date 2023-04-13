import { generateAsync } from 'stability-client';
import path from 'path';
import { Character } from '../types/types';
import { StabilityAPIError } from '../tools/exceptions';
import { GenerateResponse, GenerateData } from './types';
import { RequestContext } from '../middleware/context';

export async function GenerateFrame(
  prompt: string,
  characters: Character[],
  theme: string,
  setting: string,
  folder: string
) {
  try {
    let start = performance.now();
    let transformedPrompt = prompt;
    characters.forEach((obj) => {
      const placeholder = `{${obj.id}}`;
      transformedPrompt = transformedPrompt.replace(
        placeholder,
        obj.description
      );
    });

    const { images } = (await generateAsync({
      prompt: `HD picture of ${transformedPrompt} in the style of ${theme}. background setting: ${setting}`,
      apiKey: process.env.DREAMSTUDIO_API_KEY || '',
      outDir: folder,
    })) as GenerateResponse;
    let end = performance.now();
    RequestContext.getStore()?.logger.info(`Stability GenerateFrame took ${(end - start ) / 1000} seconds`);
    return images[0].filePath;
  } catch (e) {
    console.error(e);
    throw new StabilityAPIError();
  }
}

export async function Generate(data: GenerateData) {
  try {
    let start = performance.now();
    const { images } = (await generateAsync({
      prompt: data.prompt,
      apiKey: process.env.DREAMSTUDIO_API_KEY || '',
      seed: data.seed,
      steps: data.steps,
      cfgScale: data.scale,
      noStore: true,
    })) as GenerateResponse;

    const fileNameData = `${data.seed}_____${path.basename(
      images[0].filePath
    )}`;

    let end = performance.now();
    RequestContext.getStore()?.logger.info(`Stability Generate took ${(end - start ) / 1000} seconds`);
    return {
      data: images[0].buffer,
      fileName: fileNameData,
    };
  } catch (e) {
    console.error(`Error creating image with prompt:${data.prompt}: ${e}`);
    throw new StabilityAPIError();
  }
}

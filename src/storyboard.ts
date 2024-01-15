import { OpenAIAPIError } from './tools/exceptions';
import { validlateMainPrompt } from './tools/gptValidator';
import { callGPT } from './services/openai';
import { Character, PrimaryStoryboardResponse } from './types/types';
import path from 'path';
import {
  generateTranscripts,
  generateSRT,
  createVideoFromImagesAndAudio,
} from './tools/utilities';
import * as LocalDiffusion from './services/localDiffusion';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { RequestContext } from './middleware/context';
import { generateAudio, getRandomVoice } from './services/msCognitive';

const sampleObject = `{
  "name": "Harry Meets the Simpsons",
  "theme": "cartoonish, colorful, magical, whimsical, bright",
  "setting": "Springfield, Simpson's house, living room, cozy, animated",
  "speakers": [
    {
      "id": 1,
      "visual_description": "Harry Potter, glasses, scar, wizard, robe",
      "voice_description": "young male, British accent, confident"
    },
    {
      "id": 2,
      "visual_description": "Homer Simpson, bald, overweight, white shirt, blue pants",
      "voice_description": "adult male, American accent, slightly dopey"
    },
    {
      "id": 3,
      "visual_description": "Marge Simpson, tall blue hair, green dress, pearls",
      "voice_description": "adult female, American accent, gentle and caring"
    }
  ],
  "frames": [
    {
      "speakerId": 1,
      "dialog": "Wow, this place looks interesting!",
      "emotion": "Surprise",
      "visual_description": "{1} entering Springfield : 0.7, magical aura surrounding him : 0.3"
    },
    {
      "speakerId": 2,
      "dialog": "Hey, who's the new kid in town?",
      "emotion": "Neutral",
      "visual_description": "{2} looking curious : 0.6, {1} from a distance : 0.4"
    },
    {
      "speakerId": 3,
      "dialog": "Why don't you invite him over, Homer?",
      "emotion": "Happy",
      "visual_description": "{3} smiling at {2} : 0.6, Simpson's living room : 0.4"
    },
    {
      "speakerId": 1,
      "dialog": "Thanks for having me. I'm Harry Potter.",
      "emotion": "Neutral",
      "visual_description": "{1} entering Simpson's house : 0.5, Simpsons gathered to welcome : 0.5"
    },
    {
      "speakerId": 2,
      "dialog": "D'oh! A wizard? This is gonna be fun!",
      "emotion": "Surprise",
      "visual_description": "{2} looking excited : 0.6, {1} showing a small magic trick : 0.4"
    },
    {
      "speakerId": 3,
      "dialog": "Welcome, Harry! Make yourself at home.",
      "emotion": "Happy",
      "visual_description": "{3} offering a seat to {1} : 0.7, warm atmosphere in the room : 0.3"
    }
  ]
}
`;
const storyboard_prompt = `You are a storyboard creator. You create a movie scene with a name, setting, theme, speakers, and 6-12 frames. Return a JSON object with: a name (1-4 words), setting (3-5 words describing the background setting), theme (3-5 words describing the artistic style or painter), speakers (mapping a speakerId, a list of keywords describing the speaker's appearance (3-5 words)), and voice_description of the speaker's voice (use singular case, for the description of the voice, be sure to include the gender of the speaker).

You also return an array of frames. Each frame must include speakerId of the person speaking, brief R-rated dialog (THIS FIELD IS REQUIRED, must be at least 1 word but no more than 50 (hard limit at 200 characters) and do not include any curly braces in the dialog), emotion (pick from ['Neutral', 'Happy', 'Sad', 'Surprise', 'Angry', 'Dull'], any other value is invalid), and a visual_description for the frame following the Stability AI best practices. Use the theme, setting, and speaker.visual_description to create a weighted visual description. Make sure the description is concise, specific, uses correct terminology, and has balanced weights.

Combined descriptions (theme, setting, speaker.visual_description) should be under 15 words. Using the prompt, create information to properly describe a full movie recap, and use this as the basis for the dialog. Think of interesting things that will happen as a result of the prompt.

Here is an example of the JSON I expect back:${sampleObject}\nI will process your response through a JSON.decode(), so only reply with valid JSON in the form provided. Be sure to include at least 4 frames in the output, up to a max of 12. Focus on making the storyboard viral and entertaining. Prompt:
`;

export async function GenerateStoryboard(prompt: string) {
  const gpt_output = await GenerateStoryboardObject(prompt);

  const currentWorkingDirectory = process.cwd();
  const uniqueFolder = path.join(currentWorkingDirectory, 'temp', uuidv4());
  await fs.promises.mkdir(uniqueFolder, { recursive: true });

  const characters: Character[] = [];
  const voicesUsed: Set<string> = new Set();
  for (const x in gpt_output.speakers) {
    const desc = gpt_output.speakers[x].visual_description;
    const randomVoice = getRandomVoice(
      gpt_output.speakers[x].gender,
      voicesUsed
    );
    voicesUsed.add(randomVoice);
    characters.push({
      id: gpt_output.speakers[x].id,
      voiceName: randomVoice,
      description: desc,
    });
  }

  const imagePromises = [];
  const audioPromises: Promise<string>[] = [];

  // Do all images at once
  for (const x in gpt_output.frames) {
    imagePromises.push(
      LocalDiffusion.GenerateFrame(
        gpt_output.frames[x].visual_description,
        characters,
        gpt_output.theme_visuals,
        gpt_output.setting_description,
        uniqueFolder
      )
    );
    audioPromises.push(
      generateAudio(
        gpt_output.frames[x]['dialog'],
        characters[gpt_output.frames[x].speakerId - 1].voiceName,
        uniqueFolder,
        x
      )
    );
  }

  const audioPaths = await Promise.all(audioPromises);

  const outputVideo = `${uniqueFolder}/${gpt_output.name}.mp4`;
  const transcripts = await generateTranscripts(
    audioPaths,
    gpt_output.frames.map((frame) => frame.dialog)
  );
  const srtPath = path.join(uniqueFolder, 'subtitles.srt');
  generateSRT(transcripts, srtPath);

  const imagePaths = await Promise.all(imagePromises);
  await createVideoFromImagesAndAudio(
    imagePaths,
    audioPaths,
    srtPath,
    outputVideo
  );

  return { outputVideo, gpt_output };
}

async function GenerateStoryboardObject(prompt: string) {
  let attempts = 2;
  let clarifications = 3;
  const logger = RequestContext.getStore()?.logger;

  while (attempts-- >= 0) {
    try {
      let response =
        (await callGPT(
          `${storyboard_prompt}"""${prompt.trim()}"""`,
          [],
          [{ role: 'user', content: LocalDiffusion.ImageGenBestPractices }]
        )) || '';
      let parsedObject = JSON.parse(
        response.content ?? ''
      ) as PrimaryStoryboardResponse;
      let errors = validlateMainPrompt(parsedObject);

      // Retry once
      if (errors.length > 0) {
        while (clarifications > 0) {
          const correctingPrompt = `I have a JSON object with some constraints I'd like you to help me resolve. I would like you to return to me a modified JSON object, based on the following feedback: ${errors.join(
            '\n'
          )} Do not modify any fields not mentioned in the feedback provided. The JSON object should be identical, but with modifications to avoid thet issues specified. Only reply with the JSON object, as I will do a JSON.decode() to parse the message and expect only that object. I will send the JSON object in the next chat message.`;

          response =
            (await callGPT(
              response.content ?? '',
              [],
              [{ role: 'user', content: correctingPrompt }]
            )) || '';
          parsedObject = JSON.parse(
            response.content ?? ''
          ) as PrimaryStoryboardResponse;
          errors = validlateMainPrompt(parsedObject);

          if (errors.length === 0) {
            return parsedObject;
          }
          clarifications--;
        }
        logger?.warn(
          `Max clarifications reached. Final error: ${errors.join(',')}`
        );
        throw new SyntaxError('Max clarifications reached.');
      }
      // If parsing is successful, it will return the parsed data and exit the loop
      return parsedObject;
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger?.warn(`Syntax error: ${error}, retries left:${attempts}`);
      } else {
        // If the error is not a SyntaxError, throw it immediately
        logger?.error(
          `Non-syntax error in GenerateStoryboardObject catch: ${error}`
        );
        throw new OpenAIAPIError();
      }
    }
  }
  logger?.warn('Retry limit exceeded.');
  throw new OpenAIAPIError();
}

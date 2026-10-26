import { ToolAnswer, type ToolAnswerOptions } from './tool';
import { type ToolPageInput, toolPageDisplay, toolPageText } from '../tool/page';

export function toolPage(input: ToolPageInput, options: ToolAnswerOptions = {}): ToolAnswer {
  return new ToolAnswer(toolPageText(input), toolPageDisplay(input), options);
}

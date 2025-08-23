declare module '@ideasio/add-to-homescreen-react';

export interface Detection {
  label: string;
  score: number;
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}
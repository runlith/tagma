export type ModelArtifact = {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
};

const repository = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1';

export const models: ReadonlyArray<ModelArtifact> = [
  {
    id: 'large-v3-turbo-q5_0',
    label: 'Whisper Large v3 Turbo Q5',
    url: `${repository}/ggml-large-v3-turbo-q5_0.bin`,
    size: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
  },
  {
    id: 'large-v3-turbo',
    label: 'Whisper Large v3 Turbo',
    url: `${repository}/ggml-large-v3-turbo.bin`,
    size: 1_624_555_275,
    sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
  },
];

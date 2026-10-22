import { LuminariaBorrador } from './types';

export type RootStackParams = {
  Tabs: undefined;
  Capturar: undefined;
  Editar: { id?: number; borrador?: LuminariaBorrador; aviso?: string };
};

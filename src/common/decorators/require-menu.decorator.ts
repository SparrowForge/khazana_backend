import { SetMetadata } from '@nestjs/common';

export const REQUIRE_MENU_KEY = 'require_menu';
export const RequireMenu = (controlName: string) =>
  SetMetadata(REQUIRE_MENU_KEY, controlName);

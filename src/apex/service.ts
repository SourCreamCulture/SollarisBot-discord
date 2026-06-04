import {
  buildLegendCard,
  buildOverviewCard,
  resolveProfileDisplayName,
} from './mapper';
import { assertSupportedApexPlatform, toProviderPlatform } from './platform';
import {
  ApexError,
  type ApexApiClient,
  type ApexLegendCard,
  type ApexLegendRequest,
  type ApexLinkedAccount,
  type ApexLinkStore,
  type ApexLookupInput,
  type ApexOverviewCard,
  type ApexResolvedTarget,
  type ApexService,
} from './types';

interface CreateApexServiceOptions {
  client: ApexApiClient;
  store: ApexLinkStore;
}

const sanitizeUsername = (username: string): string => username.trim();

const createResolvedTarget = (
  source: ApexResolvedTarget['source'],
  input: ApexLookupInput,
  displayName: string,
  discordUserId?: string,
): ApexResolvedTarget => ({
  source,
  discordUserId,
  appPlatform: input.appPlatform,
  providerPlatform: toProviderPlatform(input.appPlatform),
  username: input.username ?? input.uid ?? displayName,
  uid: input.uid,
  displayName,
});

const getMissingLinkMessage = (source: 'member' | 'self'): string =>
  source === 'member'
    ? 'That Discord member has not linked an Apex account yet.'
    : 'You have not linked an Apex account yet. Use `/apex link` first.';

class DefaultApexService implements ApexService {
  constructor(
    private readonly client: ApexApiClient,
    private readonly store: ApexLinkStore,
  ) {}

  getLinkedAccount(discordUserId: string): ApexLinkedAccount | null {
    return this.store.getLink(discordUserId);
  }

  async linkAccount(input: {
    discordUserId: string;
    appPlatform: ApexLookupInput['appPlatform'];
    username?: string;
    uid?: string;
  }): Promise<ApexLinkedAccount> {
    const appPlatform = assertSupportedApexPlatform(input.appPlatform);
    const username = input.username
      ? sanitizeUsername(input.username)
      : undefined;
    const uid = input.uid ? sanitizeUsername(input.uid) : undefined;

    if (!username && !uid) {
      throw new ApexError(
        'invalid_target',
        'Provide either an Apex username or Apex UID.',
      );
    }

    if (username && uid) {
      throw new ApexError(
        'invalid_target',
        'Provide either an Apex username or Apex UID, not both.',
      );
    }

    const profile = await this.client.getProfile({
      appPlatform,
      username,
      uid,
    });
    const now = new Date().toISOString();
    const existing = this.store.getLink(input.discordUserId);
    const displayName = resolveProfileDisplayName(
      profile,
      username ?? uid ?? 'Unknown',
    );
    const link: ApexLinkedAccount = {
      discordUserId: input.discordUserId,
      appPlatform,
      providerPlatform: toProviderPlatform(appPlatform),
      username: username ?? displayName,
      uid: profile.platformInfo.platformUserIdentifier ?? uid,
      displayName,
      linkedAt: existing?.linkedAt ?? now,
      updatedAt: now,
    };

    await this.store.setLink(link);
    return link;
  }

  async unlinkAccount(discordUserId: string): Promise<boolean> {
    return this.store.deleteLink(discordUserId);
  }

  async getOverviewForSelf(discordUserId: string): Promise<ApexOverviewCard> {
    const target = this.resolveStoredTarget(discordUserId, 'self');
    return this.getOverviewForTarget(target);
  }

  async getOverviewForMember(discordUserId: string): Promise<ApexOverviewCard> {
    const target = this.resolveStoredTarget(discordUserId, 'member');
    return this.getOverviewForTarget(target);
  }

  async getOverviewForLookup(
    input: ApexLookupInput,
  ): Promise<ApexOverviewCard> {
    const appPlatform = assertSupportedApexPlatform(input.appPlatform);
    const username = input.username
      ? sanitizeUsername(input.username)
      : undefined;
    const uid = input.uid ? sanitizeUsername(input.uid) : undefined;

    if (!username && !uid) {
      throw new ApexError(
        'invalid_target',
        'Provide either an Apex username or Apex UID.',
      );
    }

    if (username && uid) {
      throw new ApexError(
        'invalid_target',
        'Provide either an Apex username or Apex UID, not both.',
      );
    }

    const profile = await this.client.getProfile({
      appPlatform,
      username,
      uid,
    });
    const target = createResolvedTarget(
      'manual',
      {
        appPlatform,
        username,
        uid: profile.platformInfo.platformUserIdentifier ?? uid,
      },
      resolveProfileDisplayName(profile, username ?? uid ?? 'Unknown'),
    );

    return buildOverviewCard(profile, target);
  }

  async getLegendForRequest(input: ApexLegendRequest): Promise<ApexLegendCard> {
    const target = this.resolveLegendTarget(input);
    const profile = await this.client.getProfile({
      appPlatform: target.appPlatform,
      username: target.username,
    });

    return buildLegendCard(profile, target, input.legend);
  }

  private async getOverviewForTarget(
    target: ApexResolvedTarget,
  ): Promise<ApexOverviewCard> {
    const profile = await this.client.getProfile({
      appPlatform: target.appPlatform,
      username: target.username,
    });

    return buildOverviewCard(profile, {
      ...target,
      displayName: resolveProfileDisplayName(profile, target.displayName),
    });
  }

  private resolveStoredTarget(
    discordUserId: string,
    source: 'member' | 'self',
  ): ApexResolvedTarget {
    const link = this.store.getLink(discordUserId);

    if (!link) {
      throw new ApexError('missing_link', getMissingLinkMessage(source));
    }

    return createResolvedTarget(
      source,
      {
        appPlatform: link.appPlatform,
        username: link.username,
        uid: link.uid,
      },
      link.displayName,
      discordUserId,
    );
  }

  private resolveLegendTarget(input: ApexLegendRequest): ApexResolvedTarget {
    if (input.memberId) {
      return this.resolveStoredTarget(input.memberId, 'member');
    }

    const hasManualPlatform = typeof input.appPlatform !== 'undefined';
    const hasManualUsername = typeof input.username !== 'undefined';
    const hasManualUid = typeof input.uid !== 'undefined';

    if (hasManualPlatform && hasManualUsername && hasManualUid) {
      throw new ApexError(
        'invalid_target',
        'For `/apex legend`, provide either `username` or `uid`, not both.',
      );
    }

    if (hasManualPlatform !== (hasManualUsername || hasManualUid)) {
      throw new ApexError(
        'invalid_target',
        'For `/apex legend`, provide `platform` with either `username` or `uid`, or provide none of them.',
      );
    }

    if (hasManualPlatform && (hasManualUsername || hasManualUid)) {
      const appPlatform = assertSupportedApexPlatform(
        input.appPlatform ?? 'pc',
      );
      const username = sanitizeUsername(input.username ?? '');
      const uid = sanitizeUsername(input.uid ?? '');

      if (!username && !uid) {
        throw new ApexError(
          'invalid_target',
          'Provide either an Apex username or Apex UID.',
        );
      }

      return createResolvedTarget(
        'manual',
        {
          appPlatform,
          username: username || undefined,
          uid: uid || undefined,
        },
        username || uid,
      );
    }

    return this.resolveStoredTarget(input.requesterId, 'self');
  }
}

export const createApexService = ({
  client,
  store,
}: CreateApexServiceOptions): ApexService =>
  new DefaultApexService(client, store);

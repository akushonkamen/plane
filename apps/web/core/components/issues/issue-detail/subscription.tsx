/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { isNil } from "lodash-es";
import { observer } from "mobx-react";
import { Bell, BellOff } from "lucide-react";
// plane-i18n
import { EUserPermissions, EUserPermissionsLevel } from "@tracktor/constants";
import { useTranslation } from "@tracktor/i18n";
// UI
import { Button } from "@tracktor/propel/button";
import { TOAST_TYPE, setToast } from "@tracktor/propel/toast";
import { EIssueServiceType } from "@tracktor/types";
import { Loader } from "@tracktor/ui";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useUserPermissions } from "@/hooks/store/user";

export type TIssueSubscription = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  serviceType?: EIssueServiceType;
};

export const IssueSubscription = observer(function IssueSubscription(props: TIssueSubscription) {
  const { workspaceSlug, projectId, issueId, serviceType = EIssueServiceType.ISSUES } = props;
  const { t } = useTranslation();
  // hooks
  const {
    subscription: { getSubscriptionByIssueId },
    createSubscription,
    removeSubscription,
  } = useIssueDetail(serviceType);
  // state
  const [loading, setLoading] = useState(false);
  // hooks
  const { allowPermissions } = useUserPermissions();

  const isSubscribed = getSubscriptionByIssueId(issueId);
  const isEditable = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );

  const handleSubscription = async () => {
    setLoading(true);
    try {
      if (isSubscribed) await removeSubscription(workspaceSlug, projectId, issueId);
      else await createSubscription(workspaceSlug, projectId, issueId);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("toast.success"),
        message: isSubscribed
          ? t("issue.subscription.actions.unsubscribed")
          : t("issue.subscription.actions.subscribed"),
      });
      setLoading(false);
    } catch {
      setLoading(false);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("toast.error"),
        message: t("common.error.message"),
      });
    }
  };

  if (isNil(isSubscribed))
    return (
      <Loader>
        <Loader.Item width="106px" height="28px" />
      </Loader>
    );

  return (
    <div>
      <Button
        prependIcon={isSubscribed ? <BellOff /> : <Bell className="h-3 w-3" />}
        variant="secondary"
        className="hover:!bg-accent-primary/20"
        onClick={handleSubscription}
        disabled={!isEditable || loading}
        size="lg"
      >
        {loading ? (
          <span>
            <span className="hidden sm:block">{t("common.loading")}</span>
          </span>
        ) : isSubscribed ? (
          <div className="hidden sm:block">{t("common.actions.unsubscribe")}</div>
        ) : (
          <div className="hidden sm:block">{t("common.actions.subscribe")}</div>
        )}
      </Button>
    </div>
  );
});

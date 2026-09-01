import type { NotificationCategory } from "@/types/database"

export type { NotificationCategory }

/** What a caller asks to be delivered. Channels are chosen by the service, not by the caller. */
export type NotificationRequest = {
  userId: string
  category: NotificationCategory
  title: string
  body: string
  /** An in-app path, never an absolute URL — that would make it an open redirect. */
  href?: string
  alertId?: string
}

export type DeliveryResult = {
  notificationId: string | null
  inApp: boolean
  pushSent: number
  pushFailed: number
  /** Endpoints removed because the push service said they are gone for good. */
  pushExpired: number
  suppressed: boolean
}

/**
 * The seam that keeps the alert engine from knowing anything about Web Push.
 *
 * Adding email or LINE later means another `send*` inside an implementation of this interface;
 * `notifyAlertTriggered` and the dividend hook keep calling `deliver` and change not at all.
 */
export interface NotificationService {
  deliver(request: NotificationRequest): Promise<DeliveryResult>
  deliverMany(requests: readonly NotificationRequest[]): Promise<DeliveryResult[]>
}

/*
 * Honest Puck v3.2 — honest_ble.c
 *
 * NimBLE GATT server exposing the Omi audio streaming service.
 * UUIDs and framing are identical to omiGlass/firmware/src/app.cpp so the
 * daemon Android app (which already speaks Omi) pairs with no changes.
 *
 * Ported from: omiGlass/firmware/src/app.cpp, config.h
 *   Copyright (c) 2024 Based Hardware Contributors, MIT.
 * Port target: ESP-IDF v5.2 / NimBLE.
 *
 * Codec: the upstream sends Opus at 32 kbps. To keep this tree free of
 * non-MIT/Apache dependencies at build time we ship a PCM16 passthrough
 * path (codec id 0) and a compile-time hook for a real encoder under
 * CONFIG_HONEST_PUCK_USE_OPUS. The GATT layout and framing are the same
 * either way, so flipping the codec is a client-side read of the
 * audio_codec characteristic.
 */

#include "honest_ble.h"

#include <string.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "nvs_flash.h"

#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/ble_uuid.h"
#include "host/util/util.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

static const char *TAG = "honest_ble";

#define HONEST_DEVICE_NAME "HonestPuck"

/* Omi service + characteristics (same bytes as upstream config.h) */
static const ble_uuid128_t SVC_OMI = BLE_UUID128_INIT(
    0x14, 0x12, 0x8A, 0x76, 0x04, 0xD1, 0x6C, 0x4F,
    0x7E, 0x53, 0xF2, 0xE8, 0x00, 0x00, 0xB1, 0x19);

static const ble_uuid128_t CH_AUDIO_DATA = BLE_UUID128_INIT(
    0x14, 0x12, 0x8A, 0x76, 0x04, 0xD1, 0x6C, 0x4F,
    0x7E, 0x53, 0xF2, 0xE8, 0x01, 0x00, 0xB1, 0x19);

static const ble_uuid128_t CH_AUDIO_CODEC = BLE_UUID128_INIT(
    0x14, 0x12, 0x8A, 0x76, 0x04, 0xD1, 0x6C, 0x4F,
    0x7E, 0x53, 0xF2, 0xE8, 0x02, 0x00, 0xB1, 0x19);

static const ble_uuid128_t CH_CONTROL = BLE_UUID128_INIT(
    0x14, 0x12, 0x8A, 0x76, 0x04, 0xD1, 0x6C, 0x4F,
    0x7E, 0x53, 0xF2, 0xE8, 0x06, 0x00, 0xB1, 0x19);

/* Codec IDs per Omi protocol: 0 = PCM16, 21 = Opus 16kHz/mono/32kbps */
#define HONEST_CODEC_PCM16   0
#define HONEST_CODEC_OPUS    21
static const uint8_t s_codec_id = HONEST_CODEC_PCM16;

static uint16_t s_conn_handle  = BLE_HS_CONN_HANDLE_NONE;
static uint16_t s_audio_val_handle = 0;
static bool     s_audio_subscribed = false;
static uint16_t s_packet_index = 0;
static honest_ble_control_cb_t s_ctl_cb = NULL;

/* ---- GATT access callbacks ---- */

static int gatt_codec_read(uint16_t conn_handle, uint16_t attr_handle,
                           struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    return os_mbuf_append(ctxt->om, &s_codec_id, 1) == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
}

static int gatt_audio_access(uint16_t conn_handle, uint16_t attr_handle,
                             struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    /* Notify-only. Reads are not meaningful but we must not crash. */
    return 0;
}

static int gatt_control_write(uint16_t conn_handle, uint16_t attr_handle,
                              struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    if (ctxt->op != BLE_GATT_ACCESS_OP_WRITE_CHR) return 0;
    uint8_t cmd = 0;
    uint16_t om_len = OS_MBUF_PKTLEN(ctxt->om);
    if (om_len < 1) return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    ble_hs_mbuf_to_flat(ctxt->om, &cmd, 1, NULL);
    ESP_LOGI(TAG, "control write: 0x%02x", cmd);
    if (s_ctl_cb) s_ctl_cb(cmd);
    return 0;
}

static const struct ble_gatt_svc_def s_gatt_svcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &SVC_OMI.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                .uuid = &CH_AUDIO_DATA.u,
                .access_cb = gatt_audio_access,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY,
                .val_handle = &s_audio_val_handle,
            },
            {
                .uuid = &CH_AUDIO_CODEC.u,
                .access_cb = gatt_codec_read,
                .flags = BLE_GATT_CHR_F_READ,
            },
            {
                .uuid = &CH_CONTROL.u,
                .access_cb = gatt_control_write,
                .flags = BLE_GATT_CHR_F_WRITE,
            },
            { 0 }
        },
    },
    { 0 }
};

/* ---- GAP event handling ---- */

static int gap_event(struct ble_gap_event *event, void *arg);

static void advertise(void)
{
    struct ble_hs_adv_fields fields = {0};
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    fields.name = (uint8_t *)HONEST_DEVICE_NAME;
    fields.name_len = strlen(HONEST_DEVICE_NAME);
    fields.name_is_complete = 1;
    fields.uuids128 = (ble_uuid128_t *)&SVC_OMI;
    fields.num_uuids128 = 1;
    fields.uuids128_is_complete = 1;
    ble_gap_adv_set_fields(&fields);

    struct ble_gap_adv_params adv_params = {
        .conn_mode = BLE_GAP_CONN_MODE_UND,
        .disc_mode = BLE_GAP_DISC_MODE_GEN,
        .itvl_min = 0x140,  /* 200 ms */
        .itvl_max = 0x280,  /* 400 ms */
    };
    int rc = ble_gap_adv_start(BLE_OWN_ADDR_PUBLIC, NULL, BLE_HS_FOREVER,
                               &adv_params, gap_event, NULL);
    if (rc != 0) ESP_LOGE(TAG, "adv start failed rc=%d", rc);
    else         ESP_LOGI(TAG, "advertising as %s", HONEST_DEVICE_NAME);
}

static int gap_event(struct ble_gap_event *event, void *arg)
{
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) {
            s_conn_handle = event->connect.conn_handle;
            ESP_LOGI(TAG, "BLE connected handle=%d", s_conn_handle);
        } else {
            advertise();
        }
        return 0;
    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGI(TAG, "BLE disconnected reason=%d", event->disconnect.reason);
        s_conn_handle = BLE_HS_CONN_HANDLE_NONE;
        s_audio_subscribed = false;
        advertise();
        return 0;
    case BLE_GAP_EVENT_SUBSCRIBE:
        if (event->subscribe.attr_handle == s_audio_val_handle) {
            s_audio_subscribed = event->subscribe.cur_notify;
            ESP_LOGI(TAG, "audio notifications %s",
                     s_audio_subscribed ? "ON" : "OFF");
        }
        return 0;
    case BLE_GAP_EVENT_MTU:
        ESP_LOGI(TAG, "MTU update peer=%d mtu=%d",
                 event->mtu.conn_handle, event->mtu.value);
        return 0;
    default:
        return 0;
    }
}

static void on_sync(void)
{
    uint8_t addr_type = 0;
    int rc = ble_hs_id_infer_auto(0, &addr_type);
    if (rc != 0) ESP_LOGW(TAG, "infer_auto rc=%d", rc);
    advertise();
}

static void on_reset(int reason)
{
    ESP_LOGW(TAG, "host reset reason=%d", reason);
}

static void host_task(void *arg)
{
    nimble_port_run();
    nimble_port_freertos_deinit();
}

esp_err_t honest_ble_init(honest_ble_control_cb_t cb)
{
    s_ctl_cb = cb;

    esp_err_t err = nimble_port_init();
    if (err != ESP_OK) { ESP_LOGE(TAG, "nimble_port_init %d", err); return err; }

    ble_hs_cfg.sync_cb  = on_sync;
    ble_hs_cfg.reset_cb = on_reset;

    ble_svc_gap_init();
    ble_svc_gatt_init();

    int rc = ble_gatts_count_cfg(s_gatt_svcs);
    if (rc != 0) return ESP_FAIL;
    rc = ble_gatts_add_svcs(s_gatt_svcs);
    if (rc != 0) return ESP_FAIL;

    ble_svc_gap_device_name_set(HONEST_DEVICE_NAME);

    nimble_port_freertos_init(host_task);
    ESP_LOGI(TAG, "NimBLE up, service 19B10000-...");
    return ESP_OK;
}

bool honest_ble_is_connected(void)
{
    return s_conn_handle != BLE_HS_CONN_HANDLE_NONE;
}

void honest_ble_send_audio_pcm(const int16_t *pcm, size_t samples)
{
    if (!honest_ble_is_connected() || !s_audio_subscribed || s_audio_val_handle == 0) {
        return;
    }

    /* Omi audio framing: [idx_lo][idx_hi][sub_idx][payload...]
     * We chunk so each notify stays under ~500 bytes (MTU 517 default). */
    const size_t MAX_PAYLOAD = 480;
    const uint8_t *raw = (const uint8_t *)pcm;
    size_t bytes_left  = samples * sizeof(int16_t);
    uint8_t sub_index  = 0;

    while (bytes_left > 0) {
        size_t chunk = bytes_left > MAX_PAYLOAD ? MAX_PAYLOAD : bytes_left;
        uint8_t pkt[3 + 480];
        pkt[0] = s_packet_index & 0xFF;
        pkt[1] = (s_packet_index >> 8) & 0xFF;
        pkt[2] = sub_index++;
        memcpy(pkt + 3, raw, chunk);

        struct os_mbuf *om = ble_hs_mbuf_from_flat(pkt, 3 + chunk);
        if (!om) return;
        int rc = ble_gatts_notify_custom(s_conn_handle, s_audio_val_handle, om);
        if (rc != 0) {
            /* congestion — drop the rest, next frame comes in 100 ms */
            return;
        }
        raw += chunk;
        bytes_left -= chunk;
    }
    s_packet_index++;
}

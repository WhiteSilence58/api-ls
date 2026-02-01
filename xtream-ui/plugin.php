<?php
/**
 * Xtream UI Scoreboard Integration Plugin
 *
 * Adds live scoreboard streams to Xtream UI
 * Version: 2.0
 */

if (!defined('XTREAM_CODES')) {
    exit('Access Denied');
}

class ScoreboardPlugin {

    private $db;
    private $api_base;

    public function __construct() {
        global $db;
        $this->db = $db;

        // Configure your scoreboard API server
        $this->api_base = $this->getConfigValue('scoreboard_api_url', 'http://localhost:3000');
    }

    /**
     * Install plugin tables
     */
    public function install() {
        $sql = "
        CREATE TABLE IF NOT EXISTS `scoreboard_streams` (
            `id` INT(11) NOT NULL AUTO_INCREMENT,
            `stream_key` VARCHAR(255) NOT NULL UNIQUE,
            `stream_name` VARCHAR(255) NOT NULL,
            `category_id` INT(11) DEFAULT NULL,
            `stream_url` TEXT NOT NULL,
            `status` ENUM('active', 'inactive') DEFAULT 'active',
            `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `stream_key` (`stream_key`),
            KEY `status` (`status`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

        CREATE TABLE IF NOT EXISTS `scoreboard_config` (
            `key` VARCHAR(255) PRIMARY KEY,
            `value` TEXT,
            `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        ";

        $this->db->multi_query($sql);

        return true;
    }

    /**
     * Add scoreboard stream to Xtream
     */
    public function addStream($streamKey, $streamName, $categoryId = null) {
        // Get stream info from API
        $streamInfo = $this->getStreamInfo($streamKey);

        if (!$streamInfo || !$streamInfo['running']) {
            return ['success' => false, 'error' => 'Stream not running'];
        }

        $streamUrl = $this->api_base . $streamInfo['playlistUrl'];

        // Check if already exists
        $stmt = $this->db->prepare("SELECT id FROM scoreboard_streams WHERE stream_key = ?");
        $stmt->bind_param('s', $streamKey);
        $stmt->execute();
        $result = $stmt->get_result();

        if ($result->num_rows > 0) {
            // Update existing
            $stmt = $this->db->prepare("
                UPDATE scoreboard_streams
                SET stream_name = ?, stream_url = ?, category_id = ?, status = 'active', updated_at = NOW()
                WHERE stream_key = ?
            ");
            $stmt->bind_param('ssis', $streamName, $streamUrl, $categoryId, $streamKey);
            $stmt->execute();
            $streamId = $result->fetch_assoc()['id'];
        } else {
            // Insert new
            $stmt = $this->db->prepare("
                INSERT INTO scoreboard_streams (stream_key, stream_name, stream_url, category_id, status)
                VALUES (?, ?, ?, ?, 'active')
            ");
            $stmt->bind_param('sssi', $streamKey, $streamName, $streamUrl, $categoryId);
            $stmt->execute();
            $streamId = $this->db->insert_id;
        }

        // Add to Xtream streams table
        $this->addToXtreamStreams($streamId, $streamName, $streamUrl, $categoryId);

        return [
            'success' => true,
            'stream_id' => $streamId,
            'stream_url' => $streamUrl
        ];
    }

    /**
     * Remove scoreboard stream
     */
    public function removeStream($streamKey) {
        $stmt = $this->db->prepare("SELECT id FROM scoreboard_streams WHERE stream_key = ?");
        $stmt->bind_param('s', $streamKey);
        $stmt->execute();
        $result = $stmt->get_result();

        if ($result->num_rows === 0) {
            return ['success' => false, 'error' => 'Stream not found'];
        }

        $streamId = $result->fetch_assoc()['id'];

        // Remove from scoreboard_streams
        $stmt = $this->db->prepare("DELETE FROM scoreboard_streams WHERE stream_key = ?");
        $stmt->bind_param('s', $streamKey);
        $stmt->execute();

        // Remove from Xtream streams
        $this->removeFromXtreamStreams($streamId);

        return ['success' => true];
    }

    /**
     * Get stream info from API
     */
    private function getStreamInfo($streamKey) {
        $url = $this->api_base . '/api/stream/status/' . urlencode($streamKey);

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        $response = curl_exec($ch);
        curl_close($ch);

        if (!$response) {
            return null;
        }

        $data = json_decode($response, true);

        return $data['success'] ? $data['status'] : null;
    }

    /**
     * Add to Xtream streams table
     */
    private function addToXtreamStreams($scoreboardId, $name, $url, $categoryId) {
        // Generate unique Xtream stream ID
        $streamId = 'scoreboard_' . $scoreboardId;

        // Check if streams table exists (different Xtream versions use different tables)
        $tables = ['streams', 'streams_sys'];

        foreach ($tables as $table) {
            $checkTable = $this->db->query("SHOW TABLES LIKE '$table'");

            if ($checkTable && $checkTable->num_rows > 0) {
                // Remove old entry if exists
                $this->db->query("DELETE FROM $table WHERE stream_display_name = '$name' AND type_key = 'scoreboard'");

                // Insert new
                $stmt = $this->db->prepare("
                    INSERT INTO $table
                    (stream_display_name, stream_source, type_key, category_id, added, direct_source)
                    VALUES (?, ?, 'scoreboard', ?, NOW(), 1)
                ");
                $stmt->bind_param('ssi', $name, $url, $categoryId);
                $stmt->execute();
            }
        }
    }

    /**
     * Remove from Xtream streams table
     */
    private function removeFromXtreamStreams($scoreboardId) {
        $streamId = 'scoreboard_' . $scoreboardId;

        $tables = ['streams', 'streams_sys'];

        foreach ($tables as $table) {
            $this->db->query("DELETE FROM $table WHERE type_key = 'scoreboard' AND id = $scoreboardId");
        }
    }

    /**
     * Sync all active streams
     */
    public function syncStreams() {
        $result = $this->db->query("SELECT * FROM scoreboard_streams WHERE status = 'active'");

        $synced = 0;
        $failed = 0;

        while ($row = $result->fetch_assoc()) {
            $streamInfo = $this->getStreamInfo($row['stream_key']);

            if ($streamInfo && $streamInfo['running']) {
                $this->addToXtreamStreams($row['id'], $row['stream_name'], $row['stream_url'], $row['category_id']);
                $synced++;
            } else {
                // Mark as inactive
                $this->db->query("UPDATE scoreboard_streams SET status = 'inactive' WHERE id = " . $row['id']);
                $failed++;
            }
        }

        return [
            'success' => true,
            'synced' => $synced,
            'failed' => $failed
        ];
    }

    /**
     * Get/Set config values
     */
    private function getConfigValue($key, $default = null) {
        $stmt = $this->db->prepare("SELECT value FROM scoreboard_config WHERE `key` = ?");
        $stmt->bind_param('s', $key);
        $stmt->execute();
        $result = $stmt->get_result();

        if ($result->num_rows > 0) {
            return $result->fetch_assoc()['value'];
        }

        return $default;
    }

    public function setConfigValue($key, $value) {
        $stmt = $this->db->prepare("
            INSERT INTO scoreboard_config (`key`, value)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE value = ?
        ");
        $stmt->bind_param('sss', $key, $value, $value);
        return $stmt->execute();
    }
}

// Initialize plugin
$scoreboardPlugin = new ScoreboardPlugin();

// Admin panel integration
if (isset($_GET['scoreboard_action'])) {
    header('Content-Type: application/json');

    switch ($_GET['scoreboard_action']) {
        case 'add_stream':
            $streamKey = $_POST['stream_key'] ?? '';
            $streamName = $_POST['stream_name'] ?? '';
            $categoryId = $_POST['category_id'] ?? null;

            echo json_encode($scoreboardPlugin->addStream($streamKey, $streamName, $categoryId));
            break;

        case 'remove_stream':
            $streamKey = $_POST['stream_key'] ?? '';
            echo json_encode($scoreboardPlugin->removeStream($streamKey));
            break;

        case 'sync_streams':
            echo json_encode($scoreboardPlugin->syncStreams());
            break;

        case 'install':
            echo json_encode(['success' => $scoreboardPlugin->install()]);
            break;
    }

    exit;
}
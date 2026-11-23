<?php
// Load inside the panel's existing authenticated, 2FA-protected routes/base.php group.
use Illuminate\Support\Facades\Route;
use Illuminate\Http\Request;

Route::get('/shinchan-signin', function (Request $request) {
    $user = $request->user();
    abort_unless($user, 403);
    $state = (string) $request->query('state');
    abort_unless(preg_match('/^[a-f0-9-]{36}$/D', $state), 400);
    $secret = config('shinchan.secret');
    $origin = rtrim((string) config('shinchan.origin'), '/');
    abort_unless(is_string($secret) && strlen($secret) >= 32 && preg_match('#^https://[a-z0-9.-]+$#iD', $origin), 503);
    $exp = time() + 90;
    $uid = (int) $user->id;
    $sig = hash_hmac('sha256', "$state|$uid|$exp", $secret);
    return redirect()->away($origin . '/shop/callback?' . http_build_query(compact('state','uid','exp','sig')))->header('Cache-Control','no-store')->header('Referrer-Policy','no-referrer');
})->middleware(['auth','throttle:20,1']);
